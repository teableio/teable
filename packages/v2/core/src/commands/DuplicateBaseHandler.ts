import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableCreationService } from '../application/services/TableCreationService';
import type { BaseId } from '../domain/base/BaseId';
import { domainError, isDomainError, type DomainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { validateForeignTablesForFields } from '../domain/table/fields/ForeignTableRelatedField';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import { RecordId } from '../domain/table/records/RecordId';
import { TableRecord } from '../domain/table/records/TableRecord';
import { TableRecordCellValue } from '../domain/table/records/TableRecordFields';
import type { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import type { NormalizedDotTeaStructure } from '../ports/DotTeaParser';
import * as EventBusPort from '../ports/EventBus';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type {
  InsertManyStreamBatch,
  RecordRestoreSystemValues,
} from '../ports/TableRecordRepository';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import type { ITableFieldInput } from '../schemas/field';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import {
  DuplicateBaseCommand,
  type DuplicateBaseDoneEvent,
  type DuplicateBaseEvent,
  type DuplicateBaseRecordInput,
  type DuplicateBaseResult,
} from './DuplicateBaseCommand';
import { buildTableFromInput } from './TableInputParser';

const sequence = <T>(
  values: ReadonlyArray<Result<T, DomainError>>
): Result<ReadonlyArray<T>, DomainError> =>
  values.reduce<Result<ReadonlyArray<T>, DomainError>>(
    (acc, next) => acc.andThen((arr) => next.map((value) => [...arr, value])),
    ok([])
  );

const uniqueForeignTableReferences = (
  refs: ReadonlyArray<LinkForeignTableReference>
): ReadonlyArray<LinkForeignTableReference> => {
  const unique: LinkForeignTableReference[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const baseKey = ref.baseId ? ref.baseId.toString() : 'local';
    const key = `${baseKey}:${ref.foreignTableId.toString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ref);
  }
  return unique;
};

const isInternalReference = (
  ref: LinkForeignTableReference,
  baseId: BaseId,
  internalTableIds: ReadonlySet<string>
): boolean => {
  if (ref.baseId && !ref.baseId.equals(baseId)) return false;
  return internalTableIds.has(ref.foreignTableId.toString());
};

const replaceMappedIds = <T>(value: T, replacements: ReadonlyMap<string, string>): T => {
  if (value == null || replacements.size === 0) return value;
  let serialized = JSON.stringify(value);
  if (serialized == null) return value;
  for (const [sourceId, targetId] of replacements) {
    serialized = serialized.split(sourceId).join(targetId);
  }
  return JSON.parse(serialized) as T;
};

@CommandHandler(DuplicateBaseCommand)
@injectable()
export class DuplicateBaseHandler
  implements ICommandHandler<DuplicateBaseCommand, DuplicateBaseResult>
{
  constructor(
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: ForeignTableLoaderService,
    @inject(v2CoreTokens.tableCreationService)
    private readonly tableCreationService: TableCreationService,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  async handle(
    context: IExecutionContext,
    command: DuplicateBaseCommand
  ): Promise<Result<DuplicateBaseResult, DomainError>> {
    return ok(this.createStream(context, command));
  }

  private async *createStream(
    context: IExecutionContext,
    command: DuplicateBaseCommand
  ): AsyncGenerator<DuplicateBaseEvent> {
    try {
      yield {
        id: 'progress',
        phase: 'table_structure_committing',
        totalTables: command.source.structure.tables.length,
      };
      const structureResult = await this.createTables(context, command);
      if (structureResult.isErr()) {
        yield this.errorEvent(structureResult.error);
        return;
      }

      const { result, tablesBySourceId } = structureResult.value;
      const totalTables = command.source.structure.tables.length;
      for (const [tableIndex, table] of command.source.structure.tables.entries()) {
        const targetTable = table.id ? tablesBySourceId.get(table.id) : undefined;
        if (!targetTable) continue;
        yield {
          id: 'progress',
          phase: 'table_structure_done',
          tableId: targetTable.id().toString(),
          tableName: targetTable.name().toString(),
          tableIndex: tableIndex + 1,
          totalTables,
        };
      }
      let recordsLength = 0;
      if (command.withRecords) {
        for (const table of command.source.structure.tables) {
          const targetTable = tablesBySourceId.get(table.id ?? '');
          if (!targetTable || !table.id) continue;

          for await (const event of this.createRecordsStream(context, command, {
            sourceTableId: table.id,
            sourceTableName: table.name ?? targetTable.name().toString(),
            targetTable,
            tableIdMap: result.tableIdMap,
            fieldIdMap: result.fieldIdMap,
            viewIdMap: result.viewIdMap,
          })) {
            yield event;
            if (event.id === 'progress' && event.phase === 'table_data_done') {
              recordsLength += event.processedRows ?? 0;
            }
          }
        }
      }

      yield {
        id: 'done',
        baseId: command.baseId.toString(),
        tableIdMap: result.tableIdMap,
        fieldIdMap: result.fieldIdMap,
        viewIdMap: result.viewIdMap,
        recordsLength,
      } satisfies DuplicateBaseDoneEvent;
    } catch (error) {
      yield this.errorEvent(
        isDomainError(error)
          ? error
          : domainError.fromUnknown(error, { code: 'duplicate_base.unexpected' })
      );
    }
  }

  private async createTables(context: IExecutionContext, command: DuplicateBaseCommand) {
    const handler = this;
    return safeTry<
      {
        result: {
          tableIdMap: Record<string, string>;
          fieldIdMap: Record<string, string>;
          viewIdMap: Record<string, string>;
        };
        tablesBySourceId: ReadonlyMap<string, Table>;
      },
      DomainError
    >(async function* () {
      const normalized = command.source.structure;
      const { remapped, tableIdMap, fieldIdMap, viewIdMap } = yield* await handler.remapStructure(
        command.baseId,
        normalized
      );

      const buildResults = yield* sequence(
        remapped.tables.map((table, tableIndex) => {
          const tableId = table.id!;
          const tableName = table.name ?? `Table ${tableIndex + 1}`;
          return buildTableFromInput(
            {
              baseId: command.baseId.toString(),
              tableId,
              name: tableName,
              fields: table.fields.map((field) => ({
                id: field.id,
                dbFieldName: field.dbFieldName,
                type: field.type as ITableFieldInput['type'],
                name: field.name,
                description: field.description,
                aiConfig: field.aiConfig,
                isPrimary: field.isPrimary,
                notNull: field.notNull,
                unique: field.unique,
                options: field.options,
                config: field.config,
                cellValueType: field.cellValueType,
                isMultipleCellValue: field.isMultipleCellValue,
              })) as ITableFieldInput[],
              views: table.views?.map((view) => ({
                id: view.id,
                type: view.type,
                name: view.name,
              })),
            },
            { executionContext: context }
          );
        })
      );

      const builtTables = buildResults.map((r) => r.table);
      const referencesByTable = buildResults.map((r) => r.foreignTableReferences);
      const allReferences = uniqueForeignTableReferences(referencesByTable.flat());
      const internalTableIds = new Set(builtTables.map((table) => table.id().toString()));
      const externalReferences = allReferences.filter(
        (ref) => !isInternalReference(ref, command.baseId, internalTableIds)
      );
      const externalTables = yield* await handler.foreignTableLoaderService.load(context, {
        baseId: command.baseId,
        references: externalReferences,
      });

      const foreignTables = [...externalTables, ...builtTables];
      for (const table of builtTables) {
        yield* validateForeignTablesForFields(table.getFields(), {
          hostTable: table,
          foreignTables,
        });
      }

      const transactionResult = yield* await handler.unitOfWork.withTransaction(
        context,
        async (transactionContext) =>
          handler.tableCreationService.execute(transactionContext, {
            baseId: command.baseId,
            tables: builtTables,
            externalTables,
            referencesByTable,
          })
      );

      const events = [
        ...builtTables.flatMap((table) => table.pullDomainEvents()),
        ...transactionResult.sideEffectEvents,
      ];
      yield* await handler.eventBus.publishMany(context, events);

      return ok({
        result: { tableIdMap, fieldIdMap, viewIdMap },
        tablesBySourceId: new Map(
          normalized.tables.flatMap((table) => {
            if (!table.id) return [];
            const targetTableId = tableIdMap[table.id];
            const persisted = transactionResult.persistedTables.find(
              (target) => target.id().toString() === targetTableId
            );
            return persisted ? ([[table.id, persisted]] as const) : [];
          })
        ),
      });
    });
  }

  private async remapStructure(baseId: BaseId, normalized: NormalizedDotTeaStructure) {
    return safeTry<
      {
        remapped: NormalizedDotTeaStructure;
        tableIdMap: Record<string, string>;
        fieldIdMap: Record<string, string>;
        viewIdMap: Record<string, string>;
      },
      DomainError
    >(async function* () {
      const tableIdMap: Record<string, string> = {};
      const fieldIdMap: Record<string, string> = {};
      const viewIdMap: Record<string, string> = {};
      const tablePlans: Array<{ tableId: string; fieldIds: string[]; viewIds: string[] }> = [];

      for (const table of normalized.tables) {
        const targetTableId = (yield* TableId.generate()).toString();
        if (table.id) tableIdMap[table.id] = targetTableId;
        const fieldIds: string[] = [];
        for (const field of table.fields) {
          const targetFieldId = (yield* FieldId.generate()).toString();
          fieldIds.push(targetFieldId);
          if (field.id) fieldIdMap[field.id] = targetFieldId;
        }
        const viewIds: string[] = [];
        for (const view of table.views ?? []) {
          const targetViewId = (yield* ViewId.generate()).toString();
          viewIds.push(targetViewId);
          if (view.id) viewIdMap[view.id] = targetViewId;
        }
        tablePlans.push({ tableId: targetTableId, fieldIds, viewIds });
      }

      const replacements = new Map<string, string>([
        ...(normalized.id ? ([[normalized.id, baseId.toString()]] as const) : []),
        ...Object.entries(tableIdMap),
        ...Object.entries(fieldIdMap),
        ...Object.entries(viewIdMap),
      ]);
      const remapped: NormalizedDotTeaStructure = {
        ...normalized,
        tables: normalized.tables.map((table, tableIndex) => {
          const plan = tablePlans[tableIndex]!;
          return {
            ...table,
            id: plan.tableId,
            fields: table.fields.map((field, fieldIndex) => ({
              ...field,
              id: plan.fieldIds[fieldIndex]!,
              options: replaceMappedIds(field.options, replacements),
              config: replaceMappedIds(field.config, replacements),
              aiConfig: replaceMappedIds(field.aiConfig, replacements),
            })),
            views: table.views?.map((view, viewIndex) => ({
              ...view,
              id: plan.viewIds[viewIndex]!,
            })),
          };
        }),
      };

      return ok({ remapped, tableIdMap, fieldIdMap, viewIdMap });
    });
  }

  private async *createRecordsStream(
    context: IExecutionContext,
    command: DuplicateBaseCommand,
    params: {
      sourceTableId: string;
      sourceTableName: string;
      targetTable: Table;
      tableIdMap: Record<string, string>;
      fieldIdMap: Record<string, string>;
      viewIdMap: Record<string, string>;
    }
  ): AsyncGenerator<DuplicateBaseEvent> {
    let totalInserted = 0;
    let batchIndex = 0;

    yield {
      id: 'progress',
      phase: 'table_data_start',
      tableId: params.targetTable.id().toString(),
      tableName: params.sourceTableName,
      processedRows: 0,
    };

    for await (const batch of this.buildInsertBatches(
      params.targetTable,
      command.source.records(params.sourceTableId),
      params.fieldIdMap,
      params.viewIdMap,
      command.batchSize
    )) {
      const currentBatchIndex = batchIndex;
      const result = await this.unitOfWork.withTransaction(context, async (transactionContext) =>
        this.tableRecordRepository.insertManyStream(
          transactionContext,
          params.targetTable,
          [batch],
          {
            deferComputedUpdates: true,
            enqueueDeferredComputedUpdates: true,
          }
        )
      );
      if (result.isErr()) {
        yield this.errorEvent(result.error);
        return;
      }

      totalInserted += result.value.totalInserted;
      yield {
        id: 'progress',
        phase: 'table_data_progress',
        tableId: params.targetTable.id().toString(),
        tableName: params.sourceTableName,
        processedRows: totalInserted,
        batchProcessedRows: result.value.totalInserted,
        currentBatch: currentBatchIndex + 1,
      };
      batchIndex += 1;
    }

    yield {
      id: 'progress',
      phase: 'table_data_done',
      tableId: params.targetTable.id().toString(),
      tableName: params.sourceTableName,
      processedRows: totalInserted,
    };
  }

  private async *buildInsertBatches(
    table: Table,
    records: AsyncIterable<DuplicateBaseRecordInput>,
    fieldIdMap: Record<string, string>,
    viewIdMap: Record<string, string>,
    batchSize: number
  ): AsyncGenerator<InsertManyStreamBatch> {
    let batch: DuplicateBaseRecordInput[] = [];
    for await (const record of records) {
      batch.push(record);
      if (batch.length >= batchSize) {
        yield this.toInsertBatch(table, batch, fieldIdMap, viewIdMap);
        batch = [];
      }
    }
    if (batch.length > 0) {
      yield this.toInsertBatch(table, batch, fieldIdMap, viewIdMap);
    }
  }

  private toInsertBatch(
    table: Table,
    batch: ReadonlyArray<DuplicateBaseRecordInput>,
    fieldIdMap: Record<string, string>,
    viewIdMap: Record<string, string>
  ): InsertManyStreamBatch {
    const records = batch.map((record) => this.toTableRecord(table, record, fieldIdMap));
    return {
      records,
      restoreRecordsById: new Map(
        batch.map((record, index) => [
          records[index]!.id().toString(),
          this.toRestoreValues(record, viewIdMap),
        ])
      ),
    };
  }

  private toTableRecord(
    table: Table,
    record: DuplicateBaseRecordInput,
    fieldIdMap: Record<string, string>
  ): TableRecord {
    const recordIdResult = record.recordId ? RecordId.create(record.recordId) : RecordId.generate();
    if (recordIdResult.isErr()) throw recordIdResult.error;
    const fieldValues = Object.entries(record.fields).flatMap(([sourceFieldId, rawValue]) => {
      const targetFieldId = fieldIdMap[sourceFieldId];
      if (!targetFieldId) return [];
      const fieldId = FieldId.create(targetFieldId);
      if (fieldId.isErr()) throw fieldId.error;
      const value = TableRecordCellValue.create(rawValue);
      if (value.isErr()) throw value.error;
      return [{ fieldId: fieldId.value, value: value.value }];
    });
    const tableRecord = TableRecord.create({
      id: recordIdResult.value,
      tableId: table.id(),
      fieldValues,
    });
    if (tableRecord.isErr()) throw tableRecord.error;
    return tableRecord.value;
  }

  private toRestoreValues(
    record: DuplicateBaseRecordInput,
    viewIdMap: Record<string, string>
  ): RecordRestoreSystemValues {
    const orders = record.orders
      ? Object.fromEntries(
          Object.entries(record.orders).flatMap(([sourceViewId, order]) => {
            const targetViewId = viewIdMap[sourceViewId];
            return targetViewId ? [[targetViewId, order]] : [];
          })
        )
      : undefined;

    return {
      ...(record.version !== undefined ? { version: record.version } : {}),
      ...(orders && Object.keys(orders).length ? { orders } : {}),
      ...(record.autoNumber !== undefined ? { autoNumber: record.autoNumber } : {}),
      ...(record.createdTime ? { createdTime: record.createdTime } : {}),
      ...(record.createdBy ? { createdBy: record.createdBy } : {}),
      ...(record.lastModifiedTime ? { lastModifiedTime: record.lastModifiedTime } : {}),
      ...(record.lastModifiedBy ? { lastModifiedBy: record.lastModifiedBy } : {}),
    };
  }

  private errorEvent(error: DomainError): DuplicateBaseEvent {
    return {
      id: 'error',
      message: error.message,
      code: error.code,
    };
  }
}
