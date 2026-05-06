import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableQueryService } from '../application/services/TableQueryService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type {
  RecordFieldValueDTO,
  RecordValuesDTO,
} from '../domain/table/events/RecordFieldValuesDTO';
import { RecordsBatchCreated } from '../domain/table/events/RecordsBatchCreated';
import { FieldId } from '../domain/table/fields/FieldId';
import { RecordId } from '../domain/table/records/RecordId';
import { TableRecord } from '../domain/table/records/TableRecord';
import { TableRecordCellValue } from '../domain/table/records/TableRecordFields';
import type { Table } from '../domain/table/Table';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { RestoreRecordsCommand, type RestoreRecordInput } from './RestoreRecordsCommand';
import { resolveRestoreRecordsBatchSize } from './shared/streamBatchSize';

export class RestoreRecordsResult {
  private constructor(
    readonly restoredCount: number,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(restoredCount: number, events: ReadonlyArray<IDomainEvent>): RestoreRecordsResult {
    return new RestoreRecordsResult(restoredCount, [...events]);
  }
}

@CommandHandler(RestoreRecordsCommand)
@injectable()
export class RestoreRecordsHandler
  implements ICommandHandler<RestoreRecordsCommand, RestoreRecordsResult>
{
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
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
    command: RestoreRecordsCommand
  ): Promise<Result<RestoreRecordsResult, DomainError>> {
    const tableResult = await this.tableQueryService.getById(context, command.tableId);
    if (tableResult.isErr()) {
      return err(tableResult.error);
    }

    const table = tableResult.value;
    let restoredCount = 0;
    const events: IDomainEvent[] = [];
    const batchSize = resolveRestoreRecordsBatchSize(command.records.length);

    for (const batch of this.restoreRecordBatches(command.records, batchSize)) {
      const records = this.buildTableRecords(table, batch);
      if (records.isErr()) {
        return err(records.error);
      }

      const restoreRecordsById = this.buildRestoreRecordsById(batch);
      const tableRecordRepository = this.tableRecordRepository;
      const persistedResult = await this.unitOfWork.withTransaction(
        context,
        async (transactionContext) => {
          return safeTry<void, DomainError>(async function* () {
            yield* await tableRecordRepository.insertMany(
              transactionContext,
              table,
              records.value,
              {
                restoreRecordsById,
                cleanupTrashRecordIds: batch.map((record) => record.recordId),
              }
            );
            return ok(undefined);
          });
        }
      );
      if (persistedResult.isErr()) {
        return err(persistedResult.error);
      }

      restoredCount += records.value.length;

      const batchEvents = this.buildBatchCreatedEvents(table, batch);
      if (batchEvents.length > 0) {
        const publishResult = await this.eventBus.publishMany(context, batchEvents);
        if (publishResult.isErr()) {
          return err(publishResult.error);
        }
        events.push(...batchEvents);
      }
    }

    return ok(RestoreRecordsResult.create(restoredCount, events));
  }

  private buildTableRecords(
    table: Table,
    batch: ReadonlyArray<RestoreRecordInput>
  ): Result<ReadonlyArray<TableRecord>, DomainError> {
    const records: TableRecord[] = [];

    for (const record of batch) {
      const recordId = RecordId.create(record.recordId);
      if (recordId.isErr()) {
        return err(recordId.error);
      }

      const fieldValues: Array<{ fieldId: FieldId; value: TableRecordCellValue }> = [];
      for (const [fieldIdRaw, rawValue] of Object.entries(record.fields)) {
        const fieldId = FieldId.create(fieldIdRaw);
        if (fieldId.isErr()) {
          return err(fieldId.error);
        }

        const cellValue = TableRecordCellValue.create(rawValue);
        if (cellValue.isErr()) {
          return err(cellValue.error);
        }

        fieldValues.push({ fieldId: fieldId.value, value: cellValue.value });
      }

      const tableRecord = TableRecord.create({
        id: recordId.value,
        tableId: table.id(),
        fieldValues,
      });
      if (tableRecord.isErr()) {
        return err(tableRecord.error);
      }

      records.push(tableRecord.value);
    }

    return ok(records);
  }

  private buildRestoreRecordsById(batch: ReadonlyArray<RestoreRecordInput>) {
    return new Map(
      batch.map((record) => [
        record.recordId,
        {
          ...(record.version !== undefined ? { version: record.version } : {}),
          ...(record.orders ? { orders: record.orders } : {}),
          ...(record.autoNumber !== undefined ? { autoNumber: record.autoNumber } : {}),
          ...(record.createdTime ? { createdTime: record.createdTime } : {}),
          ...(record.createdBy ? { createdBy: record.createdBy } : {}),
          ...(record.lastModifiedTime ? { lastModifiedTime: record.lastModifiedTime } : {}),
          ...(record.lastModifiedBy ? { lastModifiedBy: record.lastModifiedBy } : {}),
          ...(record.extraColumnValues ? { extraColumnValues: record.extraColumnValues } : {}),
        },
      ])
    );
  }

  private buildEventRecords(records: ReadonlyArray<RestoreRecordInput>): RecordValuesDTO[] {
    return records.map((record) => {
      const fields: RecordFieldValueDTO[] = Object.entries(record.fields).map(
        ([fieldId, value]) => ({
          fieldId,
          value,
        })
      );

      return { recordId: record.recordId, fields, orders: record.orders };
    });
  }

  private buildBatchCreatedEvents(
    table: Table,
    batch: ReadonlyArray<RestoreRecordInput>
  ): ReadonlyArray<IDomainEvent> {
    const eventRecords = this.buildEventRecords(batch);
    if (!eventRecords.length) {
      return [];
    }

    return [
      RecordsBatchCreated.create({
        tableId: table.id(),
        baseId: table.baseId(),
        records: eventRecords,
      }),
    ];
  }

  private *restoreRecordBatches(
    records: ReadonlyArray<RestoreRecordInput>,
    batchSize: number
  ): Iterable<ReadonlyArray<RestoreRecordInput>> {
    const normalizedBatchSize = Math.max(1, batchSize);
    for (let index = 0; index < records.length; index += normalizedBatchSize) {
      yield records.slice(index, index + normalizedBatchSize);
    }
  }
}
