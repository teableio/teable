import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableQueryService } from '../application/services/TableQueryService';
import { domainError, isDomainError, type DomainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { RecordId } from '../domain/table/records/RecordId';
import { TableRecord } from '../domain/table/records/TableRecord';
import { TableRecordCellValue } from '../domain/table/records/TableRecordFields';
import type { Table } from '../domain/table/Table';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import type { RestoreRecordInput } from './RestoreRecordsCommand';
import { RestoreRecordsStreamCommand } from './RestoreRecordsStreamCommand';

export interface RestoreRecordsStreamProgressEvent {
  id: 'progress';
  phase: 'restoring';
  batchIndex: number;
  insertedCount: number;
  totalInserted: number;
}

export interface RestoreRecordsStreamDoneEvent {
  id: 'done';
  restoredCount: number;
}

export interface RestoreRecordsStreamErrorEvent {
  id: 'error';
  phase: 'preparing' | 'restoring';
  batchIndex: number;
  totalInserted: number;
  message: string;
  code?: string;
}

export type RestoreRecordsStreamEvent =
  | RestoreRecordsStreamProgressEvent
  | RestoreRecordsStreamDoneEvent
  | RestoreRecordsStreamErrorEvent;

export type RestoreRecordsStreamResult = AsyncIterable<RestoreRecordsStreamEvent>;

@CommandHandler(RestoreRecordsStreamCommand)
@injectable()
export class RestoreRecordsStreamHandler
  implements ICommandHandler<RestoreRecordsStreamCommand, RestoreRecordsStreamResult>
{
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: RestoreRecordsStreamCommand
  ): Promise<Result<RestoreRecordsStreamResult, DomainError>> {
    return ok(this.createStream(context, command));
  }

  private async *createStream(
    context: ExecutionContextPort.IExecutionContext,
    command: RestoreRecordsStreamCommand
  ): AsyncGenerator<RestoreRecordsStreamEvent> {
    const tableResult = await this.tableQueryService.getById(context, command.tableId);
    if (tableResult.isErr()) {
      yield this.createErrorEvent(tableResult.error, 'preparing', -1, 0);
      return;
    }

    const table = tableResult.value;
    let totalInserted = 0;
    let batchIndex = 0;

    try {
      for await (const batch of this.buildInsertBatches(
        table,
        command.records,
        command.batchSize
      )) {
        const currentBatchIndex = batchIndex;
        let progressEvent: RestoreRecordsStreamProgressEvent | undefined;
        const streamResult = await this.unitOfWork.withTransaction(
          context,
          async (transactionContext) =>
            this.tableRecordRepository.insertManyStream(transactionContext, table, [batch], {
              deferComputedUpdates: command.deferComputedUpdates,
              enqueueDeferredComputedUpdates: command.enqueueDeferredComputedUpdates,
              skipComputedUpdates: command.skipComputedUpdates,
              onBatchInserted: (progress) => {
                progressEvent = {
                  id: 'progress',
                  phase: 'restoring',
                  batchIndex: currentBatchIndex,
                  insertedCount: progress.insertedCount,
                  totalInserted: totalInserted + progress.totalInserted,
                };
              },
            })
        );

        if (streamResult.isErr()) {
          yield this.createErrorEvent(
            streamResult.error,
            'restoring',
            currentBatchIndex,
            totalInserted
          );
          return;
        }

        totalInserted += streamResult.value.totalInserted;
        if (progressEvent) {
          yield progressEvent;
        }
        batchIndex += 1;
      }
    } catch (error) {
      const domainErr = isDomainError(error)
        ? error
        : domainError.fromUnknown(error, { code: 'restore_records_stream.iteration_failed' });
      yield this.createErrorEvent(domainErr, 'restoring', batchIndex, totalInserted);
      return;
    }

    yield { id: 'done', restoredCount: totalInserted };
  }

  private async *buildInsertBatches(
    table: Table,
    records: AsyncIterable<RestoreRecordInput>,
    batchSize: number
  ): AsyncGenerator<TableRecordRepositoryPort.InsertManyStreamBatch> {
    let batch: RestoreRecordInput[] = [];

    for await (const record of records) {
      batch.push(record);
      if (batch.length >= batchSize) {
        yield this.buildInsertBatch(table, batch);
        batch = [];
      }
    }

    if (batch.length > 0) {
      yield this.buildInsertBatch(table, batch);
    }
  }

  private buildInsertBatch(
    table: Table,
    batch: ReadonlyArray<RestoreRecordInput>
  ): TableRecordRepositoryPort.InsertManyStreamBatch {
    const recordsResult = this.buildTableRecords(table, batch);
    if (recordsResult.isErr()) {
      throw recordsResult.error;
    }

    return {
      records: recordsResult.value,
      restoreRecordsById: this.buildRestoreRecordsById(batch),
    };
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

  private createErrorEvent(
    error: DomainError,
    phase: RestoreRecordsStreamErrorEvent['phase'],
    batchIndex: number,
    totalInserted: number
  ): RestoreRecordsStreamErrorEvent {
    return {
      id: 'error',
      phase,
      batchIndex,
      totalInserted,
      message: error.message,
      code: error.code,
    };
  }
}
