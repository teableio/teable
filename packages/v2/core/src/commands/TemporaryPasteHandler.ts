import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';
import { err, ok, safeTry } from 'neverthrow';

import { FieldClipboardValueVisitor } from '../application/formatting/FieldClipboardValueVisitor';
import {
  LinkTitleResolverService,
  type LinkTitleResolveRequest,
} from '../application/services/LinkTitleResolverService';
import { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import { RecordQueryPluginRunner } from '../application/services/RecordQueryPluginRunner';
import { RecordWritePluginRunner } from '../application/services/RecordWritePluginRunner';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import { TableQueryService } from '../application/services/TableQueryService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import {
  convertTemporaryPasteCellValue,
  prepareTemporaryPasteSource,
  type TemporaryPasteSource,
} from '../application/services/TemporaryPasteSource';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { composeAndSpecsOrUndefined } from '../domain/shared/specification/composeAndSpecs';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { Field } from '../domain/table/fields/Field';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldKeyType } from '../domain/table/fields/FieldKeyType';
import { LinkField } from '../domain/table/fields/types/LinkField';
import { FieldToSpecVisitor } from '../domain/table/fields/visitors/FieldToSpecVisitor';
import { normalizeCellDisplayValues } from '../domain/table/fields/visitors/normalizeCellDisplayValue';
import { RecordId } from '../domain/table/records/RecordId';
import { RecordMutationSpecBuilder } from '../domain/table/records/RecordMutationSpecBuilder';
import { collectRecordSpecCellValues } from '../domain/table/records/RecordSpecMaterializer';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import type { ICellValueSpec } from '../domain/table/records/specs/values/ICellValueSpecVisitor';
import { SetLinkValueByTitleSpec } from '../domain/table/records/specs/values/SetLinkValueByTitleSpec';
import {
  SetLinkValueSpec,
  type LinkItem,
} from '../domain/table/records/specs/values/SetLinkValueSpec';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { Table } from '../domain/table/Table';
import { domainWrite, type IDomainWriteTransaction } from '../ports/DomainWriteTransaction';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { RecordQueryOperationKind } from '../ports/RecordQueryPlugin';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import { v2CoreTokens } from '../ports/tokens';
import {
  applyFieldMasksToRecords,
  collectMaskDependencyFieldIds,
} from '../queries/tableRecordFieldMasks';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { TemporaryPasteCommand } from './TemporaryPasteCommand';

export type TemporaryPasteResult = {
  readonly records: ReadonlyArray<{ fields: Record<string, unknown> }>;
};

type LinkCell = {
  readonly row: Map<string, unknown>;
  readonly field: LinkField;
  items: ReadonlyArray<LinkItem>;
};

@CommandHandler(TemporaryPasteCommand)
@injectable()
export class TemporaryPasteHandler implements ICommandHandler<
  TemporaryPasteCommand,
  TemporaryPasteResult
> {
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.recordWriteSideEffectService)
    private readonly sideEffectService: RecordWriteSideEffectService,
    @inject(v2CoreTokens.recordMutationSpecResolverService)
    private readonly specResolver: RecordMutationSpecResolverService,
    @inject(v2CoreTokens.domainWriteTransaction)
    private readonly domainWriteTransaction: IDomainWriteTransaction,
    @inject(v2CoreTokens.recordWritePluginRunner)
    private readonly recordWritePluginRunner: RecordWritePluginRunner,
    @inject(v2CoreTokens.recordQueryPluginRunner)
    private readonly recordQueryPluginRunner: RecordQueryPluginRunner,
    @inject(v2CoreTokens.linkTitleResolverService)
    private readonly linkTitleResolver: LinkTitleResolverService,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly recordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository
  ) {}

  async handle(
    context: IExecutionContext,
    command: TemporaryPasteCommand
  ): Promise<Result<TemporaryPasteResult, DomainError>> {
    const handler = this;
    const commit = await this.domainWriteTransaction.execute(
      context,
      async (transactionContext) =>
        safeTry(async function* () {
          // Reload inside the transaction: retries must not reuse a previously mutated aggregate.
          const table = yield* await handler.tableQueryService.getById(
            transactionContext,
            command.tableId
          );
          const fields = new Map(table.getFields().map((field) => [field.id().toString(), field]));
          const rows: Map<string, unknown>[] = [];
          for (const input of command.recordsFieldValues) {
            const row = new Map<string, unknown>();
            for (const [id, value] of input) {
              const field = fields.get(id);
              if (!field) return err(domainError.notFound({ message: `Field not found: ${id}` }));
              if (!field.computed().toBoolean()) row.set(id, value);
            }
            rows.push(row);
          }
          // This is its own operation: no create quotas, record ids, row defaults, or write hooks.
          const execution = yield* await handler.recordWritePluginRunner.prepare({
            kind: RecordWriteOperationKind.temporaryPaste,
            executionContext: transactionContext,
            table,
            payload: {
              recordsFieldValues: rows,
              fieldKeyType: FieldKeyType.Id,
              typecast: true,
              recordCount: rows.length,
            },
            isTransactionBound: true,
          });
          yield* await execution.guard();

          const sources = new Map<string, TemporaryPasteSource>();
          for (const row of rows) {
            for (const [id, value] of row) {
              const header = command.sourceFields?.[id];
              if (!header) continue;
              const field = fields.get(id)!;
              let source = sources.get(id);
              if (!source) {
                source = yield* prepareTemporaryPasteSource(field, header);
                sources.set(id, source);
              }
              row.set(id, yield* convertTemporaryPasteCellValue(field, source, value));
            }
          }

          const sideEffects = yield* handler.sideEffectService.execute(
            transactionContext,
            table,
            rows,
            true,
            { selectOptionOverflow: 'reject' }
          );
          const workingTable = sideEffects.table;
          let events: ReadonlyArray<IDomainEvent> = [];
          if (sideEffects.updateResult) {
            // TableUpdateFlow owns choice concurrency, persistence and metadata event extraction.
            // Keep events on the aggregate until the flow consumes them.
            const update = sideEffects.updateResult;
            const persisted = yield* await handler.tableUpdateFlow.execute(
              transactionContext,
              { table },
              () => ok(update),
              { publishEvents: false, finalizeWithinTransaction: true }
            );
            events = [...persisted.events, ...persisted.postPersistEvents];
          }

          yield* await handler.resolveLinks(transactionContext, workingTable, rows, sources);
          const workingFields = new Map(
            workingTable.getFields().map((field) => [field.id().toString(), field])
          );
          const specs: (ICellValueSpec | null)[] = [];
          for (const row of rows) {
            if (row.size === 0) {
              specs.push(null);
              continue;
            }
            const builder = RecordMutationSpecBuilder.create().withTypecast(true);
            for (const [id, value] of row) builder.set(workingFields.get(id)!, value);
            specs.push(yield* builder.build());
          }
          const resolved = yield* await handler.specResolver.resolveAndReplaceMany(
            transactionContext,
            workingTable.id(),
            specs
          );
          const records: Array<{ fields: Record<string, unknown> }> = [];
          for (const spec of resolved) {
            const values = spec ? yield* collectRecordSpecCellValues(spec) : [];
            records.push({
              fields: Object.fromEntries(
                values.map(({ fieldId, value }) => [fieldId.toString(), value.toValue()])
              ),
            });
          }
          return ok(
            domainWrite.fromEvents<TemporaryPasteResult>({ records }, events, {
              tables: [workingTable],
            })
          );
        }),
      { scope: 'meta' }
    );
    return commit.map((result) => result.value);
  }

  private async resolveLinks(
    context: IExecutionContext,
    table: Table,
    rows: ReadonlyArray<Map<string, unknown>>,
    sources: ReadonlyMap<string, TemporaryPasteSource>
  ): Promise<Result<void, DomainError>> {
    const handler = this;
    return safeTry(async function* () {
      const cells: LinkCell[] = [];
      const titleEntries: Array<{ cell: LinkCell; request: LinkTitleResolveRequest }> = [];
      const fields = table
        .getFields()
        .filter((field): field is LinkField => field instanceof LinkField);
      for (const field of fields) {
        const id = field.id().toString();
        for (const row of rows) {
          if (!row.has(id) || row.get(id) == null) continue;
          const value = row.get(id);
          const spec = sources.get(id)?.forceLinkTitles
            ? SetLinkValueByTitleSpec.create(
                field.id(),
                field.foreignTableId(),
                normalizeCellDisplayValues(value),
                field.relationship().isMultipleValue(),
                field.lookupFieldId()
              )
            : yield* field.accept(FieldToSpecVisitor.create(value, true));
          const cell: LinkCell = { row, field, items: [] };
          cells.push(cell);
          if (spec instanceof SetLinkValueByTitleSpec) {
            titleEntries.push({
              cell,
              request: {
                fieldId: field.id(),
                foreignTableId: field.foreignTableId(),
                lookupFieldId: field.lookupFieldId(),
                titles: spec.titles,
              },
            });
          } else if (spec instanceof SetLinkValueSpec) {
            const value = spec.value.toValue();
            const items: ReadonlyArray<unknown> =
              value == null ? [] : Array.isArray(value) ? value : [value];
            const references: LinkItem[] = [];
            for (const item of items) {
              if (
                !item ||
                typeof item !== 'object' ||
                !('id' in item) ||
                typeof item.id !== 'string'
              ) {
                return err(
                  domainError.validation({ message: 'Invalid temporary paste link reference' })
                );
              }
              references.push({ id: item.id });
            }
            cell.items = references;
          }
        }
      }
      const titles = yield* await handler.linkTitleResolver.resolve(
        context,
        titleEntries.map((entry) => entry.request),
        (ctx, foreign, titleField, spec) => handler.readLinkRecords(ctx, foreign, titleField, spec)
      );
      for (let index = 0; index < titles.length; index++)
        titleEntries[index]!.cell.items = titles[index]!.resolvedIds;

      // ID input is not proof of existence, readable scope, or a trustworthy title.
      // Batch by destination link field, retaining the field's configured display column.
      for (const field of fields) {
        const fieldCells = cells.filter((cell) => cell.field === field);
        const ids = new Map<string, RecordId>();
        for (const cell of fieldCells) {
          for (const item of cell.items) {
            const id = yield* RecordId.create(item.id);
            ids.set(id.toString(), id);
          }
        }
        if (ids.size === 0) {
          for (const cell of fieldCells) cell.row.set(field.id().toString(), null);
          continue;
        }
        const foreign = field.foreignTableId().equals(table.id())
          ? table
          : yield* await handler.tableQueryService.getById(context, field.foreignTableId());
        let titleField = yield* foreign.getField((candidate) =>
          candidate.id().equals(field.lookupFieldId() ?? foreign.primaryFieldId())
        );
        if (titleField.type().toString() === 'checkbox')
          titleField = yield* foreign.getField((candidate) =>
            candidate.id().equals(foreign.primaryFieldId())
          );
        const records = yield* await handler.readLinkRecords(
          context,
          foreign,
          titleField,
          RecordByIdsSpec.create([...ids.values()]),
          [...ids.keys()]
        );
        const byId = new Map(records.records.map((record) => [record.id, record]));
        for (const cell of fieldCells) {
          const items: LinkItem[] = [];
          for (const item of cell.items) {
            const record = byId.get(item.id);
            if (!record)
              return err(
                domainError.validation({
                  code: 'temporary_paste.invalid_link_reference',
                  message: 'Linked record does not exist or is not readable',
                })
              );
            const title = yield* titleField.accept(
              new FieldClipboardValueVisitor(record.fields[titleField.id().toString()])
            );
            items.push({ id: item.id, title });
          }
          cell.row.set(
            field.id().toString(),
            items.length === 0 ? null : field.relationship().isMultipleValue() ? items : items[0]
          );
        }
      }
      return ok(undefined);
    });
  }

  private async readLinkRecords(
    context: IExecutionContext,
    table: Table,
    titleField: Field,
    spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    recordIds?: ReadonlyArray<string>
  ): Promise<Result<TableRecordQueryRepositoryPort.ITableRecordQueryResult, DomainError>> {
    const handler = this;
    return safeTry(async function* () {
      const projection = [titleField.id().toString()];
      const execution = yield* await handler.recordQueryPluginRunner.prepare(
        recordIds
          ? {
              kind: RecordQueryOperationKind.getByIds,
              executionContext: context,
              table,
              payload: { recordIds, projectionFieldIds: projection },
            }
          : {
              kind: RecordQueryOperationKind.list,
              executionContext: context,
              table,
              payload: { projectionFieldIds: projection },
            }
      );
      yield* await execution.guard();
      const scope = yield* execution.getScope();
      if (scope?.readableFieldIds && !scope.readableFieldIds.has(projection[0]!)) {
        return err(domainError.forbidden({ message: 'Link display field is not readable' }));
      }
      const projectionIds = new Set([
        ...projection,
        ...collectMaskDependencyFieldIds(scope?.fieldMasks),
      ]);
      const fieldIds: FieldId[] = [];
      for (const id of projectionIds) fieldIds.push(yield* FieldId.create(id));
      const scopedSpec = composeAndSpecsOrUndefined([
        ...(spec ? [spec] : []),
        ...(scope?.recordSpec ? [scope.recordSpec] : []),
      ]);
      const result = yield* await handler.recordQueryRepository.find(context, table, scopedSpec, {
        mode: 'stored',
        projectionFieldIds: fieldIds,
        fieldMasks: scope?.fieldMasks,
        includeTotal: false,
      });
      return ok({
        ...result,
        records: applyFieldMasksToRecords(table, result.records, scope?.fieldMasks, projectionIds),
      });
    });
  }
}
