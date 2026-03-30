import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { LinkTitleResolverService } from './LinkTitleResolverService';
import { RecordBatchCreationService } from './RecordBatchCreationService';
import { TableQueryService } from './TableQueryService';
import type { DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { FieldId } from '../../domain/table/fields/FieldId';
import { FieldKeyType } from '../../domain/table/fields/FieldKeyType';
import { FieldType } from '../../domain/table/fields/FieldType';
import type { LinkField } from '../../domain/table/fields/types/LinkField';
import { RecordId } from '../../domain/table/records/RecordId';
import type { Table } from '../../domain/table/Table';
import type { TableId } from '../../domain/table/TableId';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import type { UndoRedoCommandLeafData } from '../../ports/UndoRedoStore';

export interface ResolvedLinkValue {
  readonly id: string;
  readonly title?: string;
}

export type ResolvedLinkValueMap = Map<string, ResolvedLinkValue>;
export type ResolvedLinkValueLookupMap = Map<string, ResolvedLinkValueMap>;

export interface IPasteLinkAutoResolveColumn {
  readonly fieldId: FieldId;
  readonly columnIndex: number;
}

export interface IPasteLinkAutoResolveInput {
  readonly table: Table;
  readonly editableColumns: ReadonlyArray<IPasteLinkAutoResolveColumn>;
  readonly rowDataList: ReadonlyArray<ReadonlyArray<unknown>>;
  readonly existingResolvedValues?: ResolvedLinkValueLookupMap;
}

export interface IPasteLinkAutoResolveResult {
  readonly resolvedValues: ResolvedLinkValueLookupMap;
  readonly tableEvents: ReadonlyArray<IDomainEvent>;
  readonly undoCommands: ReadonlyArray<UndoRedoCommandLeafData>;
  readonly redoCommands: ReadonlyArray<UndoRedoCommandLeafData>;
  readonly afterCommitHandlers: ReadonlyArray<() => Promise<void>>;
}

type LinkResolveEntry = {
  readonly fieldId: string;
  readonly linkField: LinkField;
  readonly titles: ReadonlyArray<string>;
};

@injectable()
export class PasteLinkAutoResolveService {
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.linkTitleResolverService)
    private readonly linkTitleResolverService: LinkTitleResolverService,
    @inject(v2CoreTokens.recordBatchCreationService)
    private readonly recordBatchCreationService: RecordBatchCreationService
  ) {}

  async resolve(
    context: IExecutionContext,
    input: IPasteLinkAutoResolveInput
  ): Promise<Result<IPasteLinkAutoResolveResult, DomainError>> {
    const service = this;

    return safeTry<IPasteLinkAutoResolveResult, DomainError>(async function* () {
      const entries = yield* await service.collectEntries(input);
      if (entries.length === 0) {
        return ok({
          resolvedValues: new Map(),
          tableEvents: [],
          undoCommands: [],
          redoCommands: [],
          afterCommitHandlers: [],
        });
      }

      const foreignTableCache = new Map<string, Table>();
      for (const entry of entries) {
        const foreignTable = yield* await service.loadForeignTable(
          context,
          foreignTableCache,
          entry.linkField.foreignTableId()
        );
        yield* service.validateAutoCreateEligibility(
          input.table,
          entry.linkField,
          foreignTable,
          entry.titles
        );
      }

      const resolveResults = yield* await service.linkTitleResolverService.resolve(
        context,
        entries.map((entry) => ({
          fieldId: entry.linkField.id(),
          foreignTableId: entry.linkField.foreignTableId(),
          titles: entry.titles,
        }))
      );

      const resolvedValues: ResolvedLinkValueLookupMap = new Map();
      const tableEvents: IDomainEvent[] = [];
      const undoCommands: UndoRedoCommandLeafData[] = [];
      const redoCommands: UndoRedoCommandLeafData[] = [];
      const afterCommitHandlers: Array<() => Promise<void>> = [];

      const missingByGroup = new Map<
        string,
        { entryIndexes: number[]; missingTitles: Set<string> }
      >();

      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index]!;
        const existingResult = resolveResults[index]!;
        const existingMap: ResolvedLinkValueMap = new Map(
          input.existingResolvedValues?.get(entry.fieldId) ?? []
        );
        for (const item of existingResult.resolvedIds) {
          existingMap.set(item.title, { id: item.id, title: item.title });
        }
        resolvedValues.set(entry.fieldId, existingMap);

        const missingTitles = entry.titles.filter((title) => !existingMap.has(title));
        if (missingTitles.length === 0) {
          continue;
        }

        const groupKey = `${entry.linkField.foreignTableId().toString()}:${entry.linkField.lookupFieldId().toString()}`;
        const group = missingByGroup.get(groupKey) ?? {
          entryIndexes: [],
          missingTitles: new Set<string>(),
        };
        group.entryIndexes.push(index);
        missingTitles.forEach((title) => group.missingTitles.add(title));
        missingByGroup.set(groupKey, group);
      }

      for (const group of missingByGroup.values()) {
        const firstEntry = entries[group.entryIndexes[0]!]!;
        const foreignTable = yield* await service.loadForeignTable(
          context,
          foreignTableCache,
          firstEntry.linkField.foreignTableId()
        );
        const createdTitles = [...group.missingTitles];
        const creationResult = yield* await service.recordBatchCreationService.create(context, {
          table: foreignTable,
          recordsFieldValues: createdTitles.map(
            (title) =>
              new Map<string, unknown>([
                [foreignTable.primaryFieldId().toString(), title],
              ]) as ReadonlyMap<string, unknown>
          ),
          fieldKeyType: FieldKeyType.Id,
          typecast: true,
          isTransactionBound: true,
        });

        tableEvents.push(...creationResult.events);
        undoCommands.push(...creationResult.undoCommands);
        redoCommands.push(...creationResult.redoCommands);
        afterCommitHandlers.push(creationResult.afterCommit);

        const createdMap: ResolvedLinkValueMap = new Map();
        for (let index = 0; index < createdTitles.length; index++) {
          const title = createdTitles[index]!;
          const record = creationResult.records[index]!;
          createdMap.set(title, {
            id: record.id().toString(),
            title,
          });
        }

        for (const entryIndex of group.entryIndexes) {
          const entry = entries[entryIndex]!;
          const valueMap: ResolvedLinkValueMap = resolvedValues.get(entry.fieldId) ?? new Map();
          createdMap.forEach((value, title) => {
            if (!valueMap.has(title)) {
              valueMap.set(title, value);
            }
          });
          resolvedValues.set(entry.fieldId, valueMap);
        }
      }

      return ok({
        resolvedValues,
        tableEvents,
        undoCommands,
        redoCommands,
        afterCommitHandlers,
      });
    });
  }

  private async collectEntries(
    input: IPasteLinkAutoResolveInput
  ): Promise<Result<ReadonlyArray<LinkResolveEntry>, DomainError>> {
    const entries: LinkResolveEntry[] = [];
    for (const column of input.editableColumns) {
      const fieldResult = input.table.getField((candidate) =>
        candidate.id().equals(column.fieldId)
      );
      if (fieldResult.isErr()) {
        return err(fieldResult.error);
      }

      const field = fieldResult.value;
      if (!field.type().equals(FieldType.link())) {
        continue;
      }

      const titles = new Set<string>();
      for (const rowData of input.rowDataList) {
        for (const title of this.extractLinkTitles(rowData[column.columnIndex])) {
          titles.add(title);
        }
      }

      if (titles.size === 0) {
        continue;
      }

      entries.push({
        fieldId: column.fieldId.toString(),
        linkField: field as LinkField,
        titles: [...titles],
      });
    }

    return ok(entries);
  }

  private async loadForeignTable(
    context: IExecutionContext,
    cache: Map<string, Table>,
    foreignTableId: TableId
  ): Promise<Result<Table, DomainError>> {
    const foreignTableIdStr = foreignTableId.toString();
    const cached = cache.get(foreignTableIdStr);
    if (cached) {
      return ok(cached);
    }

    const tableResult = await this.tableQueryService.getById(context, foreignTableId);
    if (tableResult.isErr()) {
      return tableResult;
    }
    cache.set(foreignTableIdStr, tableResult.value);
    return tableResult;
  }

  private validateAutoCreateEligibility(
    hostTable: Table,
    linkField: LinkField,
    foreignTable: Table,
    titles: ReadonlyArray<string>
  ): Result<void, DomainError> {
    if (titles.length === 0) {
      return ok(undefined);
    }

    return linkField.validateAutoCreateTarget(hostTable, foreignTable);
  }

  private extractLinkTitles(value: unknown): string[] {
    if (value == null) return [];

    const values = Array.isArray(value) ? value : [value];
    const titles: string[] = [];

    for (const item of values) {
      if (typeof item === 'string') {
        const tokens = item
          .split(',')
          .map((token) => token.trim())
          .filter(Boolean)
          .filter((token) => !this.isRecordIdToken(token));
        titles.push(...tokens);
        continue;
      }

      if (typeof item === 'number' || typeof item === 'boolean' || typeof item === 'bigint') {
        titles.push(String(item));
      }
    }

    return titles;
  }

  private isRecordIdToken(token: string): boolean {
    return RecordId.create(token).isOk();
  }
}
