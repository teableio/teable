import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  beginTableSchemaOperation,
  completeTableSchemaOperation,
  failTableSchemaOperation,
} from '../application/services/TableSchemaOperationLifecycleService';
import { TableQueryService } from '../application/services/TableQueryService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { Field } from '../domain/table/fields/Field';
import { FieldType } from '../domain/table/fields/FieldType';
import { LinkField } from '../domain/table/fields/types/LinkField';
import { RecordId } from '../domain/table/records/RecordId';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { Table } from '../domain/table/Table';
import { RecordCreated, isRecordCreatedEvent } from '../domain/table/events/RecordCreated';
import { RecordsBatchCreated } from '../domain/table/events/RecordsBatchCreated';
import type { ITableMapper } from '../ports/mappers/TableMapper';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import type { RecordRestoreSystemValues } from '../ports/TableRecordRepository';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import * as TableSchemaRepositoryPort from '../ports/TableSchemaRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { DuplicateTableCommand } from './DuplicateTableCommand';

export class DuplicateTableResult {
  private constructor(
    readonly table: Table,
    readonly fieldIdMap: ReadonlyMap<string, string>,
    readonly viewIdMap: ReadonlyMap<string, string>,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(
    table: Table,
    fieldIdMap: ReadonlyMap<string, string>,
    viewIdMap: ReadonlyMap<string, string>,
    events: ReadonlyArray<IDomainEvent>
  ): DuplicateTableResult {
    return new DuplicateTableResult(table, new Map(fieldIdMap), new Map(viewIdMap), [...events]);
  }
}

@CommandHandler(DuplicateTableCommand)
@injectable()
export class DuplicateTableHandler
  implements ICommandHandler<DuplicateTableCommand, DuplicateTableResult>
{
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.tableMapper)
    private readonly tableMapper: ITableMapper,
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableSchemaRepository)
    private readonly tableSchemaRepository: TableSchemaRepositoryPort.ITableSchemaRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: DuplicateTableCommand
  ): Promise<Result<DuplicateTableResult, DomainError>> {
    const handler = this;
    return safeTry<DuplicateTableResult, DomainError>(async function* () {
      const sourceTable = yield* await handler.tableQueryService.getByIdInBase(
        context,
        command.baseId,
        command.tableId
      );
      const duplicated = yield* sourceTable.duplicate({
        mapper: handler.tableMapper,
        newName: command.name,
      });

      let records: ReadonlyArray<TableRecord> = [];
      let restoreRecordsById: ReadonlyMap<string, RecordRestoreSystemValues> | undefined;

      if (command.includeRecords) {
        const prepared = yield* await handler.prepareDuplicatedRecords(
          context,
          sourceTable,
          duplicated
        );
        records = prepared.records;
        restoreRecordsById = prepared.restoreRecordsById;
      }

      const persistedTable = yield* await handler.unitOfWork.withTransaction(
        context,
        async (metaTransactionContext) =>
          safeTry<Table, DomainError>(async function* () {
            const persistedTable = yield* await handler.tableRepository.insert(
              metaTransactionContext,
              duplicated.table
            );
            yield* await beginTableSchemaOperation(
              handler.unitOfWork,
              handler.tableRepository,
              metaTransactionContext,
              persistedTable,
              { type: 'table.duplicate' }
            );

            return ok(persistedTable);
          }),
        { scope: 'meta' }
      );

      const duplicateResult = await handler.unitOfWork.withTransaction(
        context,
        async (dataTransactionContext) =>
          safeTry<void, DomainError>(async function* () {
            yield* await handler.tableSchemaRepository.insert(
              dataTransactionContext,
              persistedTable
            );

            if (records.length > 0) {
              yield* await handler.tableRecordRepository.insertMany(
                dataTransactionContext,
                persistedTable,
                records,
                restoreRecordsById ? { restoreRecordsById } : undefined
              );
            }

            return ok(undefined);
          }),
        { scope: 'data' }
      );
      if (duplicateResult.isErr()) {
        yield* await failTableSchemaOperation(
          handler.unitOfWork,
          handler.tableRepository,
          context,
          persistedTable,
          {
            lastError: duplicateResult.error.message,
            type: 'table.duplicate',
          }
        );
        return err(duplicateResult.error);
      }

      yield* await completeTableSchemaOperation(
        handler.unitOfWork,
        handler.tableRepository,
        context,
        persistedTable,
        { type: 'table.duplicate' }
      );

      const events = aggregateDuplicateTableEvents(
        [...duplicated.table.pullDomainEvents(), ...persistedTable.pullDomainEvents()],
        persistedTable,
        restoreRecordsById
      );

      const previousDuplicateContext = context.duplicateTable;
      context.duplicateTable = {
        sourceTableId: command.tableId.toString(),
        duplicatedTableId: persistedTable.id().toString(),
        includeRecords: command.includeRecords,
      };

      try {
        yield* await handler.eventBus.publishMany(context, events);
      } finally {
        context.duplicateTable = previousDuplicateContext;
      }

      return ok(
        DuplicateTableResult.create(
          persistedTable,
          duplicated.fieldIdMap,
          duplicated.viewIdMap,
          events
        )
      );
    });
  }

  private async prepareDuplicatedRecords(
    context: ExecutionContextPort.IExecutionContext,
    sourceTable: Table,
    duplicated: {
      table: Table;
      fieldIdMap: ReadonlyMap<string, string>;
      viewIdMap: ReadonlyMap<string, string>;
    }
  ): Promise<
    Result<
      {
        records: ReadonlyArray<TableRecord>;
        restoreRecordsById: ReadonlyMap<string, RecordRestoreSystemValues>;
      },
      DomainError
    >
  > {
    const handler = this;
    return safeTry<
      {
        records: ReadonlyArray<TableRecord>;
        restoreRecordsById: ReadonlyMap<string, RecordRestoreSystemValues>;
      },
      DomainError
    >(async function* () {
      const sourceRecords = yield* await handler.tableRecordQueryRepository.find(
        context,
        sourceTable,
        undefined,
        {
          mode: 'stored',
          includeOrders: true,
          includeTotal: false,
        }
      );

      const sourceRecordIds = sourceRecords.records.map((record) => record.id);
      const duplicatedRecordIdMap = new Map<string, string>();
      for (const sourceRecordId of sourceRecordIds) {
        duplicatedRecordIdMap.set(sourceRecordId, (yield* RecordId.generate()).toString());
      }

      const seeds: Array<{ id: RecordId; fieldValues: ReadonlyMap<string, unknown> }> = [];
      for (const record of sourceRecords.records) {
        const duplicatedRecordId = duplicatedRecordIdMap.get(record.id);
        if (!duplicatedRecordId) {
          throw new Error(`Missing duplicated record id for ${record.id}`);
        }

        seeds.push({
          id: yield* RecordId.create(duplicatedRecordId),
          fieldValues: buildDuplicatedRecordFieldValues({
            sourceTable,
            sourceRecord: record,
            fieldIdMap: duplicated.fieldIdMap,
            recordIdMap: duplicatedRecordIdMap,
          }),
        });
      }
      const duplicatedRecords = yield* duplicated.table.createRecords(seeds);

      const restoreRecordsById = new Map<string, RecordRestoreSystemValues>();
      for (const sourceRecord of sourceRecords.records) {
        const duplicatedRecordId = duplicatedRecordIdMap.get(sourceRecord.id);
        if (!duplicatedRecordId) continue;

        const duplicatedOrders = remapRecordOrders(sourceRecord.orders, duplicated.viewIdMap);
        if (!duplicatedOrders || Object.keys(duplicatedOrders).length === 0) continue;

        restoreRecordsById.set(duplicatedRecordId, {
          orders: duplicatedOrders,
        });
      }

      return ok({
        records: duplicatedRecords.records,
        restoreRecordsById,
      });
    });
  }
}

const remapRecordOrders = (
  sourceOrders: Record<string, number> | undefined,
  viewIdMap: ReadonlyMap<string, string>
): Record<string, number> | undefined => {
  if (!sourceOrders) return undefined;

  const remapped = Object.entries(sourceOrders).reduce<Record<string, number>>(
    (acc, [sourceViewId, order]) => {
      const duplicatedViewId = viewIdMap.get(sourceViewId);
      if (duplicatedViewId) {
        acc[duplicatedViewId] = order;
      }
      return acc;
    },
    {}
  );

  return Object.keys(remapped).length > 0 ? remapped : undefined;
};

const aggregateDuplicateTableEvents = (
  rawEvents: ReadonlyArray<IDomainEvent>,
  table: Table,
  restoreRecordsById?: ReadonlyMap<string, RecordRestoreSystemValues>
): ReadonlyArray<IDomainEvent> => {
  const recordCreatedEvents = rawEvents.filter(isRecordCreatedEvent);

  if (!recordCreatedEvents.length) {
    return [...rawEvents];
  }

  const batchEvent = RecordsBatchCreated.create({
    tableId: table.id(),
    baseId: table.baseId(),
    records: recordCreatedEvents.map((event) => ({
      recordId: event.recordId.toString(),
      fields: event.fieldValues,
      orders: restoreRecordsById?.get(event.recordId.toString())?.orders,
    })),
    source: recordCreatedEvents[0]?.source ?? { type: 'user' },
  });

  const aggregatedEvents: IDomainEvent[] = [];
  let batchInserted = false;

  for (const event of rawEvents) {
    if (isRecordCreatedEvent(event)) {
      if (!batchInserted) {
        aggregatedEvents.push(batchEvent);
        batchInserted = true;
      }
      continue;
    }

    aggregatedEvents.push(event);
  }

  return aggregatedEvents;
};

const buildDuplicatedRecordFieldValues = (params: {
  sourceTable: Table;
  sourceRecord: { id: string; fields: Record<string, unknown> };
  fieldIdMap: ReadonlyMap<string, string>;
  recordIdMap: ReadonlyMap<string, string>;
}): ReadonlyMap<string, unknown> => {
  const values = new Map<string, unknown>();
  const sourceTableId = params.sourceTable.id().toString();

  for (const field of params.sourceTable.getEditableFields()) {
    const duplicatedFieldId = params.fieldIdMap.get(field.id().toString());
    if (!duplicatedFieldId) continue;
    if (field.type().equals(FieldType.button())) continue;
    if (shouldSkipSelfSymmetricLinkFieldValue(field, sourceTableId)) continue;

    const sourceValue = params.sourceRecord.fields[field.id().toString()];
    if (sourceValue === undefined) continue;

    if (isInternalSelfLinkField(field, sourceTableId)) {
      values.set(duplicatedFieldId, remapSelfLinkCellValue(sourceValue, params.recordIdMap));
      continue;
    }

    values.set(duplicatedFieldId, sourceValue);
  }

  return values;
};

const isInternalSelfLinkField = (field: Field, sourceTableId: string): boolean =>
  isLinkField(field) && field.foreignTableId().toString() === sourceTableId;

const shouldSkipSelfSymmetricLinkFieldValue = (field: Field, sourceTableId: string): boolean => {
  if (!isLinkField(field)) return false;
  if (field.foreignTableId().toString() !== sourceTableId || field.isOneWay()) return false;

  const symmetricFieldId = field.symmetricFieldId();
  if (!symmetricFieldId) return false;
  return field.id().toString() > symmetricFieldId.toString();
};

const isLinkField = (field: Field): field is LinkField => {
  return field instanceof LinkField;
};

const remapSelfLinkCellValue = (
  value: unknown,
  recordIdMap: ReadonlyMap<string, string>
): unknown => {
  if (value == null) return value;

  if (Array.isArray(value)) {
    return value
      .map((item) => remapSelfLinkCellValue(item, recordIdMap))
      .filter((item) => item !== undefined && item !== null);
  }

  if (typeof value === 'string') {
    return recordIdMap.get(value) ?? null;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'string') {
      const duplicatedRecordId = recordIdMap.get(record.id);
      if (!duplicatedRecordId) return null;
      return {
        ...record,
        id: duplicatedRecordId,
      };
    }

    return Object.entries(record).reduce<Record<string, unknown>>((acc, [key, nestedValue]) => {
      acc[key] = remapSelfLinkCellValue(nestedValue, recordIdMap);
      return acc;
    }, {});
  }

  return value;
};
