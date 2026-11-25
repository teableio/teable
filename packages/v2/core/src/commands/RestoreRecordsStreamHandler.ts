import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { createRecordCreateOperationProjectionDraft } from '../application/services/DomainWriteTransaction';
import {
  RecordWritePluginRunner,
  type RecordWritePluginExecution,
} from '../application/services/RecordWritePluginRunner';
import { TableQueryService } from '../application/services/TableQueryService';
import { assertRecordActorStorageEnabled } from '../application/services/withRecordWriteCoordination';
import { domainError, isDomainError, type DomainError } from '../domain/shared/DomainError';
import { generateUuid } from '../domain/shared/IdGenerator';
import { FieldId } from '../domain/table/fields/FieldId';
import { RecordId } from '../domain/table/records/RecordId';
import { TableRecord } from '../domain/table/records/TableRecord';
import { TableRecordCellValue } from '../domain/table/records/TableRecordFields';
import type { Table } from '../domain/table/Table';
import type { IDurableSubscriptionCatalog } from '../ports/DurableSubscriptionCatalog';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import type { ITableSchemaCoordination } from '../ports/TableSchemaCoordination';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import type { ITransactionalProjectionMessageJournal } from '../ports/TransactionalProjectionMessageJournal';
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
export class RestoreRecordsStreamHandler implements ICommandHandler<
  RestoreRecordsStreamCommand,
  RestoreRecordsStreamResult
> {
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork,
    @inject(v2CoreTokens.recordWritePluginRunner)
    private readonly recordWritePluginRunner: RecordWritePluginRunner,
    @inject(v2CoreTokens.tableSchemaCoordination)
    private readonly tableSchemaCoordination: ITableSchemaCoordination,
    @inject(v2CoreTokens.durableSubscriptionCatalog)
    private readonly subscriptionCatalog: IDurableSubscriptionCatalog,
    @inject(v2CoreTokens.projectionMessageJournal)
    private readonly projectionJournal: ITransactionalProjectionMessageJournal
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
    const lease = await this.tableSchemaCoordination.acquire(
      context,
      [command.tableId.toString()],
      'shared'
    );
    if (lease.isErr()) {
      yield this.createErrorEvent(lease.error, 'preparing', -1, 0);
      return;
    }
    try {
      yield* this.createStreamUnderLease(context, command);
    } finally {
      await lease.value.release();
    }
  }

  private async *createStreamUnderLease(
    context: ExecutionContextPort.IExecutionContext,
    command: RestoreRecordsStreamCommand
  ): AsyncGenerator<RestoreRecordsStreamEvent> {
    context = {
      ...context,
      initiator: context.initiator ? Object.freeze({ ...context.initiator }) : undefined,
      operationAttribution: Object.freeze(
        context.operationAttribution
          ? { ...context.operationAttribution }
          : { operationId: generateUuid(), occurredAt: new Date().toISOString() }
      ),
    };
    const catalog = this.subscriptionCatalog.snapshot(context);
    if (catalog.isErr()) {
      yield this.createErrorEvent(catalog.error, 'preparing', -1, 0);
      return;
    }
    const tableResult = await this.tableQueryService.getById(context, command.tableId);
    if (tableResult.isErr()) {
      yield this.createErrorEvent(tableResult.error, 'preparing', -1, 0);
      return;
    }

    const table = tableResult.value;
    const actorStorage = assertRecordActorStorageEnabled(context, table);
    if (actorStorage.isErr()) {
      yield this.createErrorEvent(actorStorage.error, 'preparing', -1, 0);
      return;
    }
    let totalInserted = 0;
    let batchIndex = 0;
    let previousPluginExecution: RecordWritePluginExecution | undefined;

    try {
      for await (const batch of this.buildInsertBatches(
        table,
        command.records,
        command.batchSize,
        command.trustedCreatedActorsByRecordId
      )) {
        const currentBatchIndex = batchIndex;
        const pluginExecutionResult = await this.recordWritePluginRunner.prepare(
          {
            kind: RecordWriteOperationKind.restoreMany,
            executionContext: context,
            table,
            payload: {
              recordsFieldValues: batch.records.map(
                (record) =>
                  new Map(
                    record
                      .fields()
                      .entries()
                      .map((entry) => [entry.fieldId.toString(), entry.value.toValue()])
                  )
              ),
              recordCount: batch.records.length,
            },
            isTransactionBound: false,
          },
          previousPluginExecution ? { previousExecution: previousPluginExecution } : undefined
        );
        if (pluginExecutionResult.isErr()) {
          yield this.createErrorEvent(
            pluginExecutionResult.error,
            'restoring',
            currentBatchIndex,
            totalInserted
          );
          return;
        }
        previousPluginExecution = pluginExecutionResult.value;
        const pluginGuardResult = await previousPluginExecution.guard();
        if (pluginGuardResult.isErr()) {
          yield this.createErrorEvent(
            pluginGuardResult.error,
            'restoring',
            currentBatchIndex,
            totalInserted
          );
          return;
        }

        let progressEvent: RestoreRecordsStreamProgressEvent | undefined;
        const streamResult = await this.unitOfWork.withTransaction(
          context,
          async (transactionContext) => {
            const inserted = await this.tableRecordRepository.insertManyStream(
              transactionContext,
              table,
              [batch],
              {
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
              }
            );
            if (inserted.isErr()) return err(inserted.error);
            const draft = createRecordCreateOperationProjectionDraft(
              transactionContext,
              {
                tableId: table.id(),
                baseId: table.baseId(),
                recordCount: inserted.value.totalInserted,
                recordIds: batch.records.slice(0, 200).map((record) => record.id().toString()),
                source: { type: command.trustedCreatedActorsByRecordId ? 'restore' : 'import' },
              },
              catalog.value
            );
            if (draft.isErr()) return err(draft.error);
            if (draft.value) {
              const appended = await this.projectionJournal.append(transactionContext, [
                draft.value,
              ]);
              if (appended.isErr()) return err(appended.error);
            }
            return inserted;
          }
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
    batchSize: number,
    trustedCreatedActorsByRecordId?: RestoreRecordsStreamCommand['trustedCreatedActorsByRecordId']
  ): AsyncGenerator<TableRecordRepositoryPort.InsertManyStreamBatch> {
    let batch: RestoreRecordInput[] = [];

    for await (const record of records) {
      batch.push(record);
      if (batch.length >= batchSize) {
        yield this.buildInsertBatch(table, batch, trustedCreatedActorsByRecordId);
        batch = [];
      }
    }

    if (batch.length > 0) {
      yield this.buildInsertBatch(table, batch, trustedCreatedActorsByRecordId);
    }
  }

  private buildInsertBatch(
    table: Table,
    batch: ReadonlyArray<RestoreRecordInput>,
    trustedCreatedActorsByRecordId?: RestoreRecordsStreamCommand['trustedCreatedActorsByRecordId']
  ): TableRecordRepositoryPort.InsertManyStreamBatch {
    const recordsResult = this.buildTableRecords(table, batch);
    if (recordsResult.isErr()) {
      throw recordsResult.error;
    }

    return {
      records: recordsResult.value,
      restoreRecordsById: this.buildRestoreRecordsById(batch, trustedCreatedActorsByRecordId),
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

  private buildRestoreRecordsById(
    batch: ReadonlyArray<RestoreRecordInput>,
    trustedCreatedActorsByRecordId?: RestoreRecordsStreamCommand['trustedCreatedActorsByRecordId']
  ) {
    return new Map(
      batch.map((record) => [
        record.recordId,
        {
          ...(record.version !== undefined ? { version: record.version } : {}),
          ...(trustedCreatedActorsByRecordId
            ? { createdByActor: trustedCreatedActorsByRecordId.get(record.recordId) ?? null }
            : {}),
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
