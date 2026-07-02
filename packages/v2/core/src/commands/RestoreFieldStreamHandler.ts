import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableQueryService } from '../application/services/TableQueryService';
import { domainError, isDomainError, type DomainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import type { UpdateRecordItem } from '../domain/table/methods/records';
import { RecordId } from '../domain/table/records/RecordId';
import type { RecordUpdateResult } from '../domain/table/records/RecordUpdateResult';
import { TableRecordCellValue } from '../domain/table/records/TableRecordFields';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import type { Table } from '../domain/table/Table';
import type { ICommandBus } from '../ports/CommandBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as FieldTrashRepositoryPort from '../ports/FieldTrashRepository';
import { AsyncIterableQueue } from '../ports/memory/AsyncIterableQueue';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import type { ITableFieldInput } from '../schemas/field';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { CreateFieldsCommand } from './CreateFieldsCommand';
import type { CreateFieldsResult } from './CreateFieldsHandler';
import { toRestoreFieldCreateInput } from './RestoreFieldSnapshotInput';
import { RestoreFieldStreamCommand } from './RestoreFieldStreamCommand';

export interface RestoreFieldStreamProgressEvent {
  id: 'progress';
  phase: 'preparing' | 'restoring';
  batchIndex: number;
  totalCount: number;
  processedCount: number;
  updatedCount: number;
}

export interface RestoreFieldStreamDoneEvent {
  id: 'done';
  totalCount: number;
  updatedCount: number;
}

export interface RestoreFieldStreamErrorEvent {
  id: 'error';
  phase: 'preparing' | 'restoring' | 'finalizing';
  batchIndex: number;
  totalCount: number;
  processedCount: number;
  updatedCount: number;
  message: string;
  code?: string;
}

export type RestoreFieldStreamEvent =
  | RestoreFieldStreamProgressEvent
  | RestoreFieldStreamDoneEvent
  | RestoreFieldStreamErrorEvent;

export type RestoreFieldStreamResult = AsyncIterable<RestoreFieldStreamEvent>;

const MAX_RESTORE_FIELD_STREAM_BUFFERED_EVENTS = 64;

type RestoreRecordValuesFailure = {
  readonly error: DomainError;
  readonly batchIndex: number;
  readonly processedCount: number;
  readonly updatedCount: number;
};

@injectable()
export class RestoreFieldStreamApplicationService {
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.commandBus)
    private readonly commandBus: ICommandBus,
    @inject(v2CoreTokens.fieldTrashRepository)
    private readonly fieldTrashRepository: FieldTrashRepositoryPort.IFieldTrashRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  createStream(
    context: ExecutionContextPort.IExecutionContext,
    command: RestoreFieldStreamCommand
  ): RestoreFieldStreamResult {
    const queue = new AsyncIterableQueue<RestoreFieldStreamEvent>({
      maxBufferedItems: MAX_RESTORE_FIELD_STREAM_BUFFERED_EVENTS,
    });
    void this.runRestoreFieldStream(context, command, queue);
    return queue;
  }

  private async runRestoreFieldStream(
    context: ExecutionContextPort.IExecutionContext,
    command: RestoreFieldStreamCommand,
    queue: AsyncIterableQueue<RestoreFieldStreamEvent>
  ): Promise<void> {
    queue.push(this.createProgressEvent('preparing', 0, 0, 0, -1));

    try {
      const restorePlanResult = await this.prepareRestorePlan(context, command);
      if (restorePlanResult.isErr()) {
        queue.push(this.createErrorEvent(restorePlanResult.error, 'preparing', -1, 0, 0, 0));
        return;
      }

      const plan = restorePlanResult.value;
      queue.push(this.createProgressEvent('preparing', plan.totalCount, 0, 0, -1));

      const restoredTableResult = await this.restoreFields(context, command, plan.trash);
      if (restoredTableResult.isErr()) {
        queue.push(
          this.createErrorEvent(restoredTableResult.error, 'preparing', -1, plan.totalCount, 0, 0)
        );
        return;
      }

      const restoreResult = await this.restoreRecordValues(
        context,
        command,
        restoredTableResult.value,
        plan.records,
        queue
      );
      if (restoreResult.isErr()) {
        queue.push(
          this.createErrorEvent(
            restoreResult.error.error,
            'restoring',
            restoreResult.error.batchIndex,
            plan.totalCount,
            restoreResult.error.processedCount,
            restoreResult.error.updatedCount
          )
        );
        return;
      }

      const deleteResult = await this.fieldTrashRepository.deleteFieldTrash(
        context,
        command.tableId.toString(),
        command.trashId
      );
      if (deleteResult.isErr()) {
        queue.push(
          this.createErrorEvent(
            deleteResult.error,
            'finalizing',
            -1,
            plan.totalCount,
            restoreResult.value.updatedCount,
            restoreResult.value.updatedCount
          )
        );
        return;
      }

      queue.push(this.createDoneEvent(plan.totalCount, restoreResult.value.updatedCount));
    } catch (error) {
      const domainErr = isDomainError(error)
        ? error
        : domainError.fromUnknown(error, { code: 'restore_field_stream.failed' });
      queue.push(this.createErrorEvent(domainErr, 'restoring', -1, 0, 0, 0));
    } finally {
      queue.close();
    }
  }

  private async prepareRestorePlan(
    context: ExecutionContextPort.IExecutionContext,
    command: RestoreFieldStreamCommand
  ): Promise<
    Result<
      {
        table: Table;
        trash: FieldTrashRepositoryPort.FieldTrashSnapshot;
        records: ReadonlyArray<FieldTrashRepositoryPort.FieldTrashRecordSnapshot>;
        totalCount: number;
      },
      DomainError
    >
  > {
    const service = this;
    return safeTry(async function* () {
      const table = yield* await service.tableQueryService.getById(context, command.tableId);
      const trash = yield* await service.fieldTrashRepository.getFieldTrash(
        context,
        command.tableId.toString(),
        command.trashId
      );
      const compactedRecords = service.compactFieldRestoreRecords(trash.records);
      const records = yield* await service.filterExistingRecords(context, table, compactedRecords);
      return ok({ table, trash, records, totalCount: records.length });
    });
  }

  private async restoreFields(
    context: ExecutionContextPort.IExecutionContext,
    command: RestoreFieldStreamCommand,
    trash: FieldTrashRepositoryPort.FieldTrashSnapshot
  ): Promise<Result<Table, DomainError>> {
    const table = await this.tableQueryService.getById(context, command.tableId);
    if (table.isErr()) {
      return err(table.error);
    }

    const fieldsResult = this.normalizeRestoreFields(trash.fields);
    if (fieldsResult.isErr()) {
      return err(fieldsResult.error);
    }

    const createCommandResult = CreateFieldsCommand.create({
      baseId: table.value.baseId().toString(),
      tableId: command.tableId.toString(),
      fields: fieldsResult.value,
    });
    if (createCommandResult.isErr()) {
      return err(createCommandResult.error);
    }

    const createResult = await this.commandBus.execute<CreateFieldsCommand, CreateFieldsResult>(
      context,
      createCommandResult.value
    );
    if (createResult.isErr()) {
      return err(createResult.error);
    }

    return ok(createResult.value.table);
  }

  private normalizeRestoreFields(
    fields: ReadonlyArray<unknown>
  ): Result<ReadonlyArray<ITableFieldInput>, DomainError> {
    const normalized: ITableFieldInput[] = [];
    for (const field of fields) {
      const result = toRestoreFieldCreateInput(field);
      if (result.isErr()) {
        return err(result.error);
      }
      normalized.push(result.value);
    }
    return ok(normalized);
  }

  private async restoreRecordValues(
    context: ExecutionContextPort.IExecutionContext,
    command: RestoreFieldStreamCommand,
    table: Table,
    records: ReadonlyArray<FieldTrashRepositoryPort.FieldTrashRecordSnapshot>,
    queue: AsyncIterableQueue<RestoreFieldStreamEvent>
  ): Promise<
    Result<{ updatedCount: number }, RestoreRecordValuesFailure>
  > {
    let updatedCount = 0;
    let processedCount = 0;
    let batchIndex = 0;

    for (let index = 0; index < records.length; index += command.batchSize) {
      const chunk = records.slice(index, index + command.batchSize);
      const batchResult = this.buildUpdateBatch(table, chunk, command.batchSize);
      if (batchResult.isErr()) {
        return err({ error: batchResult.error, batchIndex, processedCount, updatedCount });
      }

      const streamResult = await this.unitOfWork.withTransaction(context, async (transactionContext) =>
        this.tableRecordRepository.updateManyStream(transactionContext, table, [batchResult], {
          deferComputedUpdates: command.deferComputedUpdates,
          enqueueDeferredComputedUpdates: command.enqueueDeferredComputedUpdates,
          skipComputedUpdates: command.skipComputedUpdates,
          onBatchUpdated: (progress) => {
            updatedCount += progress.updatedCount;
            processedCount += chunk.length;
            queue.push(
              this.createProgressEvent(
                'restoring',
                records.length,
                processedCount,
                updatedCount,
                batchIndex
              )
            );
          },
        })
      );
      if (streamResult.isErr()) {
        return err({ error: streamResult.error, batchIndex, processedCount, updatedCount });
      }

      batchIndex += 1;
    }

    return ok({ updatedCount });
  }

  private async filterExistingRecords(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    records: ReadonlyArray<FieldTrashRepositoryPort.FieldTrashRecordSnapshot>
  ): Promise<Result<ReadonlyArray<FieldTrashRepositoryPort.FieldTrashRecordSnapshot>, DomainError>> {
    const recordIds = records.map((record) => RecordId.create(record.id));
    const invalidRecordId = recordIds.find((result) => result.isErr());
    if (invalidRecordId?.isErr()) {
      return err(invalidRecordId.error);
    }

    if (recordIds.length === 0) {
      return ok([]);
    }

    const queryResult = await this.tableRecordQueryRepository.find(
      context,
      table,
      RecordByIdsSpec.create(recordIds.map((result) => result._unsafeUnwrap())),
      { includeTotal: false, mode: 'stored' }
    );
    if (queryResult.isErr()) {
      return err(queryResult.error);
    }

    const existingIdSet = new Set(queryResult.value.records.map((record) => record.id));
    return ok(records.filter((record) => existingIdSet.has(record.id)));
  }

  private compactFieldRestoreRecords(
    records: ReadonlyArray<FieldTrashRepositoryPort.FieldTrashRecordSnapshot>
  ): ReadonlyArray<FieldTrashRepositoryPort.FieldTrashRecordSnapshot> {
    return records.flatMap((record) => {
      const fields = Object.fromEntries(
        Object.entries(record.fields ?? {}).filter(([, value]) => !this.isEmptyRestoreValue(value))
      );
      return Object.keys(fields).length ? [{ id: record.id, fields }] : [];
    });
  }

  private isEmptyRestoreValue(value: unknown): boolean {
    return value == null || (Array.isArray(value) && value.length === 0);
  }

  private buildUpdateBatch(
    table: Table,
    batch: ReadonlyArray<FieldTrashRepositoryPort.FieldTrashRecordSnapshot>,
    batchSize: number
  ): Result<ReadonlyArray<RecordUpdateResult>, DomainError> {
    return this.buildUpdateItems(batch).andThen((updates) => {
      const [updateBatch] = table.updateRecordsStream(updates, {
        typecast: false,
        batchSize,
        maxBatchSize: batchSize,
      });
      return updateBatch ?? ok([]);
    });
  }

  private buildUpdateItems(
    batch: ReadonlyArray<FieldTrashRepositoryPort.FieldTrashRecordSnapshot>
  ): Result<ReadonlyArray<UpdateRecordItem>, DomainError> {
    const updates: UpdateRecordItem[] = [];

    for (const record of batch) {
      const recordId = RecordId.create(record.id);
      if (recordId.isErr()) {
        return err(recordId.error);
      }

      const fieldValues = new Map<string, unknown>();
      for (const [fieldIdRaw, rawValue] of Object.entries(record.fields ?? {})) {
        const fieldId = FieldId.create(fieldIdRaw);
        if (fieldId.isErr()) {
          return err(fieldId.error);
        }

        const cellValue = TableRecordCellValue.create(rawValue);
        if (cellValue.isErr()) {
          return err(cellValue.error);
        }

        fieldValues.set(fieldId.value.toString(), cellValue.value.toValue());
      }

      updates.push({ recordId: recordId.value, fieldValues });
    }

    return ok(updates);
  }

  private createProgressEvent(
    phase: RestoreFieldStreamProgressEvent['phase'],
    totalCount: number,
    processedCount: number,
    updatedCount: number,
    batchIndex: number
  ): RestoreFieldStreamProgressEvent {
    return { id: 'progress', phase, batchIndex, totalCount, processedCount, updatedCount };
  }

  private createDoneEvent(totalCount: number, updatedCount: number): RestoreFieldStreamDoneEvent {
    return { id: 'done', totalCount, updatedCount };
  }

  private createErrorEvent(
    error: DomainError,
    phase: RestoreFieldStreamErrorEvent['phase'],
    batchIndex: number,
    totalCount: number,
    processedCount: number,
    updatedCount: number
  ): RestoreFieldStreamErrorEvent {
    return {
      id: 'error',
      phase,
      batchIndex,
      totalCount,
      processedCount,
      updatedCount,
      message: error.message,
      code: error.code,
    };
  }
}

@CommandHandler(RestoreFieldStreamCommand)
@injectable()
export class RestoreFieldStreamHandler
  implements ICommandHandler<RestoreFieldStreamCommand, RestoreFieldStreamResult>
{
  constructor(
    @inject(v2CoreTokens.restoreFieldStreamApplicationService)
    private readonly restoreFieldStreamApplicationService: RestoreFieldStreamApplicationService
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: RestoreFieldStreamCommand
  ): Promise<Result<RestoreFieldStreamResult, DomainError>> {
    return ok(this.restoreFieldStreamApplicationService.createStream(context, command));
  }
}
