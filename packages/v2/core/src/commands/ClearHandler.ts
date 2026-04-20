import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { areRecordFieldValuesEqual } from '../application/services/RecordFieldValueEquality';
import {
  type RecordWritePluginExecution,
  RecordWritePluginRunner,
} from '../application/services/RecordWritePluginRunner';
import { TableQueryService } from '../application/services/TableQueryService';
import {
  toUndoRedoStackAppendContext,
  UndoRedoStackService,
} from '../application/services/UndoRedoStackService';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { generateUuid } from '../domain/shared/IdGenerator';
import { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import { PageLimit } from '../domain/shared/pagination/PageLimit';
import { PageOffset } from '../domain/shared/pagination/PageOffset';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type {
  RecordFieldChangeDTO,
  RecordUpdateDTO,
} from '../domain/table/events/RecordFieldValuesDTO';
import { RecordsBatchUpdated } from '../domain/table/events/RecordsBatchUpdated';
import type { FieldId } from '../domain/table/fields/FieldId';
import { FieldKeyType } from '../domain/table/fields/FieldKeyType';
import type { UpdateRecordItem } from '../domain/table/methods/records';
import { RecordId } from '../domain/table/records/RecordId';
import type { RecordUpdateResult } from '../domain/table/records/RecordUpdateResult';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { Table } from '../domain/table/Table';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { AsyncIterableQueue } from '../ports/memory/AsyncIterableQueue';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import type { TableRecordOrderBy } from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { createUndoRedoCommand, type UndoRedoCommandLeafData } from '../ports/UndoRedoStore';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { buildSanitizedRecordConditionSpec } from '../queries/RecordFilterMapper';
import { resolveVisibleRowSearch } from '../queries/RecordSearch';
import { ClearCommand } from './ClearCommand';
import { ClearStreamCommand } from './ClearStreamCommand';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import {
  buildOperationBatchMutation,
  withBatchMutation,
} from './shared/batchMutationOrchestration';
import {
  mergeOrderByWithViewRowTieBreaker,
  resolveGroupByToOrderBy,
  resolveOrderBy,
} from './shared/orderBy';
import { resolveSelectionStreamBatchSize } from './shared/streamBatchSize';
import { toTableRecord } from './shared/toTableRecord';

const filterScopedFieldIds = <T extends { toString(): string }>(
  fieldIds: ReadonlyArray<T>,
  allowedFieldIds: ReadonlySet<string> | undefined
): T[] => {
  if (!allowedFieldIds) {
    return [...fieldIds];
  }

  return fieldIds.filter((fieldId) => allowedFieldIds.has(fieldId.toString()));
};

const reconcilePersistedUpdateEvents = (
  eventData: ReadonlyArray<RecordUpdateDTO>,
  updateResult: TableRecordRepositoryPort.UpdateManyStreamResult
): RecordUpdateDTO[] => {
  const updatesWithChanges = eventData.filter((update) => update.changes.length > 0);
  const persistedRecords = new Map(
    updateResult.updatedRecords.map((record) => [record.recordId.toString(), record])
  );

  const reconciledUpdates: RecordUpdateDTO[] = [];
  for (const update of updatesWithChanges) {
    const persistedRecord = persistedRecords.get(update.recordId);
    if (!persistedRecord) {
      continue;
    }

    const changes: RecordFieldChangeDTO[] = [];
    for (const change of update.changes) {
      const oldValue = Object.prototype.hasOwnProperty.call(
        persistedRecord.oldFieldValues,
        change.fieldId
      )
        ? persistedRecord.oldFieldValues[change.fieldId]
        : change.oldValue;
      if (areRecordFieldValuesEqual(oldValue, change.newValue)) {
        continue;
      }
      changes.push({ ...change, oldValue });
    }
    if (changes.length === 0) {
      continue;
    }

    reconciledUpdates.push({
      ...update,
      oldVersion: persistedRecord.oldVersion,
      newVersion: persistedRecord.newVersion,
      changes,
    });
  }

  return reconciledUpdates;
};

const buildUpdateRecordsUndoRedoCommand = (
  tableId: string,
  updates: ReadonlyArray<RecordUpdateDTO>,
  valueSelector: (change: RecordFieldChangeDTO) => unknown
): UndoRedoCommandLeafData =>
  createUndoRedoCommand('UpdateRecords', {
    tableId,
    fieldKeyType: 'id',
    typecast: false,
    records: updates.map((update) => ({
      id: update.recordId,
      fields: Object.fromEntries(
        update.changes.map((change) => [change.fieldId, valueSelector(change)])
      ),
    })),
  });

export interface ClearResult {
  /** Number of records updated (cleared) */
  updatedCount: number;
}

export interface ClearStreamProgressEvent {
  id: 'progress';
  phase: 'preparing' | 'clearing';
  batchIndex: number;
  totalCount: number;
  processedCount: number;
  clearedCount: number;
  batchProcessedCount: number;
  batchClearedCount: number;
}

export interface ClearStreamDoneEvent {
  id: 'done';
  totalCount: number;
  processedCount: number;
  clearedCount: number;
  data: {
    clearedCount: number;
    clearedRecordIds: string[];
  };
}

export interface ClearStreamErrorEvent {
  id: 'error';
  phase: 'preparing' | 'guarding' | 'clearing' | 'publishing' | 'finalizing';
  batchIndex: number;
  totalCount: number;
  processedCount: number;
  clearedCount: number;
  recordIds: string[];
  message: string;
  code?: string;
}

export type ClearStreamEvent =
  | ClearStreamProgressEvent
  | ClearStreamDoneEvent
  | ClearStreamErrorEvent;

const MAX_CLEAR_STREAM_BUFFERED_EVENTS = 64;

@CommandHandler(ClearCommand)
@injectable()
export class ClearHandler implements ICommandHandler<ClearCommand, ClearResult> {
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    protected readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.recordWritePluginRunner)
    protected readonly recordWritePluginRunner: RecordWritePluginRunner,
    @inject(v2CoreTokens.tableRecordRepository)
    protected readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    protected readonly tableRecordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository,
    @inject(v2CoreTokens.eventBus)
    protected readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.undoRedoService)
    protected readonly undoRedoStackService: UndoRedoStackService,
    @inject(v2CoreTokens.unitOfWork)
    protected readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: ClearCommand
  ): Promise<Result<ClearResult, DomainError>> {
    const handler = this;

    return safeTry<ClearResult, DomainError>(async function* () {
      // 1. Get table
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);

      // 2. Get ordered visible field IDs from view's columnMeta
      const orderedFieldIds = yield* table.getOrderedVisibleFieldIds(command.viewId.toString(), {
        projection: command.projection,
      });
      const totalCols = orderedFieldIds.length;

      const view = yield* table.getView(command.viewId);
      const viewDefaults = yield* view.queryDefaults();
      const mergedDefaults = viewDefaults.merge({
        filter: command.filter,
        sort: command.sort,
        group: command.groupBy,
      });
      const effectiveFilter = command.ignoreViewQuery
        ? command.filter ?? undefined
        : mergedDefaults.filter();
      const effectiveSort = command.ignoreViewQuery
        ? command.sort ?? undefined
        : mergedDefaults.sort();

      // 3. Build filter spec from effective view filter. Search-aware visible rows are handled
      // by the query repository so field-type-specific search semantics stay centralized.
      const filterSpec = yield* buildSanitizedRecordConditionSpec(table, effectiveFilter);
      const visibleRowSearch = resolveVisibleRowSearch(command.search, orderedFieldIds);

      // 4. Get total row count for columns/rows type normalization
      let totalRows = 0;
      if (command.rangeType === 'columns' || command.rangeType === 'rows') {
        const limitResult = PageLimit.create(1);
        if (limitResult.isOk()) {
          const pagination = OffsetPagination.create(limitResult.value, PageOffset.zero());
          const countResult = yield* await handler.tableRecordQueryRepository.find(
            context,
            table,
            filterSpec,
            { mode: 'stored', pagination, search: visibleRowSearch }
          );
          totalRows = countResult.total;
        }
      }

      // 5. Normalize ranges
      const normalizedRanges = command.normalizeRanges(totalRows, totalCols);
      const [[startCol, startRow], [endCol, endRow]] = normalizedRanges;
      const targetRowCount = endRow - startRow + 1;
      const targetColCount = endCol - startCol + 1;

      // Early return if nothing to clear
      if (targetRowCount <= 0 || targetColCount <= 0) {
        return ok({ updatedCount: 0 });
      }

      // 6. Get target fields
      const targetFieldIds = orderedFieldIds.slice(startCol, startCol + targetColCount);

      // 7. Filter out computed fields only - notNull validation is handled at database level
      const editableFieldIds = targetFieldIds.filter((fieldId) => {
        const fieldResult = table.getField((f) => f.id().equals(fieldId));
        if (fieldResult.isErr()) {
          return false;
        }
        const field = fieldResult.value;
        return !field.computed().toBoolean();
      });

      if (editableFieldIds.length === 0) {
        return ok({ updatedCount: 0 });
      }

      const initialClearedFieldValues = new Map<string, unknown>();
      for (const fieldId of editableFieldIds) {
        initialClearedFieldValues.set(fieldId.toString(), null);
      }
      const initialPluginExecution = yield* await handler.recordWritePluginRunner.prepare({
        kind: RecordWriteOperationKind.updateMany,
        executionContext: context,
        table,
        payload: {
          variant: 'selector',
          fieldValues: initialClearedFieldValues,
          fieldKeyType: FieldKeyType.Id,
          typecast: false,
          recordIds: [],
          recordCount: 0,
        },
        isTransactionBound: false,
      });
      const pluginScope = yield* initialPluginExecution.getScope();
      const scopedEditableFieldIds = filterScopedFieldIds(
        editableFieldIds,
        pluginScope?.updateFieldIds
      );
      const pluginRecordSpec = pluginScope?.recordSpec;

      const clearedFieldValues = new Map<string, unknown>();
      for (const fieldId of scopedEditableFieldIds) {
        clearedFieldValues.set(fieldId.toString(), null);
      }

      if (scopedEditableFieldIds.length === 0) {
        const pluginExecution = yield* await handler.recordWritePluginRunner.prepare({
          kind: RecordWriteOperationKind.updateMany,
          executionContext: context,
          table,
          payload: {
            variant: 'selector',
            fieldValues: clearedFieldValues,
            fieldKeyType: FieldKeyType.Id,
            typecast: false,
            recordIds: [],
            recordCount: 0,
          },
          isTransactionBound: false,
        });
        yield* await pluginExecution.guard();
        return ok({ updatedCount: 0 });
      }

      // 8. Build orderBy from group + sort for correct row mapping
      // If none provided, fall back to view row order column (__row_{viewId})
      const effectiveGroup = command.ignoreViewQuery
        ? command.groupBy ?? undefined
        : mergedDefaults.group();
      const groupByOrderBy = yield* resolveGroupByToOrderBy(effectiveGroup);
      const sortOrderBy = yield* resolveOrderBy(effectiveSort);
      const orderBy = mergeOrderByWithViewRowTieBreaker(
        groupByOrderBy,
        sortOrderBy,
        command.viewId.toString()
      );

      // 9. Query existing records in the range
      const existingRecordsStream = handler.tableRecordQueryRepository.findStream(
        context,
        table,
        filterSpec,
        {
          mode: 'stored',
          pagination: { offset: startRow, limit: targetRowCount },
          orderBy,
          search: visibleRowSearch,
        }
      );

      // 10. Collect records and build update operations
      const eventData: RecordUpdateDTO[] = [];
      const updateItems: UpdateRecordItem[] = [];

      for await (const recordResult of existingRecordsStream) {
        if (recordResult.isErr()) {
          return err(recordResult.error);
        }

        const record = recordResult.value;
        let tableRecord: TableRecord | undefined;
        if (pluginRecordSpec || pluginScope?.resolveUpdateFieldIdsForRecord) {
          tableRecord = yield* toTableRecord(table, record);
        }
        if (pluginRecordSpec && tableRecord && !pluginRecordSpec.isSatisfiedBy(tableRecord)) {
          continue;
        }
        const recordId = yield* RecordId.create(record.id);
        const fieldValues = new Map<string, unknown>();
        const changes: RecordFieldChangeDTO[] = [];

        const perRecordAllowedFieldIds = tableRecord
          ? yield* initialPluginExecution.getUpdateFieldIdsForRecord(tableRecord)
          : undefined;
        const recordScopedEditableFieldIds = filterScopedFieldIds(
          scopedEditableFieldIds,
          perRecordAllowedFieldIds
        );
        if (recordScopedEditableFieldIds.length === 0) {
          continue;
        }

        for (const fieldId of recordScopedEditableFieldIds) {
          const fieldIdStr = fieldId.toString();
          const oldValue = record.fields[fieldIdStr];
          const newValue = null;
          if (areRecordFieldValuesEqual(oldValue, newValue)) {
            continue;
          }
          fieldValues.set(fieldIdStr, newValue);
          changes.push({ fieldId: fieldIdStr, oldValue, newValue });
        }

        if (changes.length === 0) continue;

        updateItems.push({ recordId, fieldValues });
        eventData.push({
          recordId: record.id,
          oldVersion: record.version,
          newVersion: record.version + 1,
          changes,
        });
      }

      if (updateItems.length === 0) {
        const pluginExecution = yield* await handler.recordWritePluginRunner.prepare({
          kind: RecordWriteOperationKind.updateMany,
          executionContext: context,
          table,
          payload: {
            variant: 'selector',
            fieldValues: clearedFieldValues,
            fieldKeyType: FieldKeyType.Id,
            typecast: false,
            recordIds: [],
            recordCount: 0,
          },
          isTransactionBound: false,
        });
        yield* await pluginExecution.guard();
        return ok({ updatedCount: 0 });
      }
      const pluginExecution = yield* await handler.recordWritePluginRunner.prepare({
        kind: RecordWriteOperationKind.updateMany,
        executionContext: context,
        table,
        payload: {
          variant: 'selector',
          fieldValues: clearedFieldValues,
          fieldKeyType: FieldKeyType.Id,
          typecast: false,
          recordIds: updateItems.map((item) => item.recordId),
          recordCount: updateItems.length,
        },
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();

      const batchMutation = buildOperationBatchMutation(context, updateItems.length);

      // 11. Execute updates within transaction
      const updateResult = yield* await handler.unitOfWork.withTransaction(
        context,
        async (txContext) => {
          const txContextWithBatchMutation = withBatchMutation(txContext, batchMutation);
          const beforePersistResult = await pluginExecution.beforePersist(
            txContextWithBatchMutation
          );
          if (beforePersistResult.isErr()) {
            return err(beforePersistResult.error);
          }
          return handler.executeUpdates(txContextWithBatchMutation, table, updateItems);
        }
      );
      const persistedEventData = reconcilePersistedUpdateEvents(eventData, updateResult);

      // 12. Publish events after transaction commits
      if (persistedEventData.length > 0) {
        const event = RecordsBatchUpdated.create({
          tableId: table.id(),
          baseId: table.baseId(),
          updates: persistedEventData,
          source: 'user',
          orchestration: batchMutation,
        });
        yield* await handler.eventBus.publishMany(context, [event]);
      }

      if (persistedEventData.length > 0) {
        const tableIdText = table.id().toString();

        yield* await handler.undoRedoStackService.appendEntry(
          toUndoRedoStackAppendContext(context),
          table.id(),
          {
            groupId: batchMutation.groupId,
            undoCommand: buildUpdateRecordsUndoRedoCommand(
              tableIdText,
              persistedEventData,
              (change) => change.oldValue
            ),
            redoCommand: buildUpdateRecordsUndoRedoCommand(
              tableIdText,
              persistedEventData,
              (change) => change.newValue
            ),
          }
        );
      }
      await pluginExecution.afterCommit();

      return ok({ updatedCount: updateResult.totalUpdated });
    });
  }

  protected async executeUpdates(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    updateItems: ReadonlyArray<UpdateRecordItem>
  ): Promise<Result<TableRecordRepositoryPort.UpdateManyStreamResult, DomainError>> {
    const handler = this;

    return safeTry<TableRecordRepositoryPort.UpdateManyStreamResult, DomainError>(
      async function* () {
        // Generate update batches - typecast is false since we're setting null values
        const updateBatches = table.updateRecordsStream(updateItems, { typecast: false });

        const batchResults: Array<Result<ReadonlyArray<RecordUpdateResult>, DomainError>> = [];
        for (const batch of updateBatches) {
          batchResults.push(batch);
        }

        function* syncBatchesGenerator(): Generator<
          Result<ReadonlyArray<RecordUpdateResult>, DomainError>
        > {
          for (const batch of batchResults) {
            yield batch;
          }
        }

        const updateResult = yield* await handler.tableRecordRepository.updateManyStream(
          context,
          table,
          syncBatchesGenerator()
        );

        return ok(updateResult);
      }
    );
  }
}

type PreparedClearStreamPlan = {
  readonly table: Table;
  readonly targetFieldIds: ReadonlyArray<FieldId>;
  readonly totalCount: number;
  readonly chunkPlans: ReadonlyArray<{
    batchIndex: number;
    records: ReadonlyArray<TableRecordReadModel>;
  }>;
};

type ClearChunkBuildResult = {
  readonly updateItems: ReadonlyArray<UpdateRecordItem>;
  readonly eventData: ReadonlyArray<RecordUpdateDTO>;
  readonly recordIds: ReadonlyArray<RecordId>;
};

@injectable()
export class ClearStreamApplicationService extends ClearHandler {
  createStream(
    context: ExecutionContextPort.IExecutionContext,
    command: ClearStreamCommand
  ): AsyncIterable<ClearStreamEvent> {
    const queue = new AsyncIterableQueue<ClearStreamEvent>({
      maxBufferedItems: MAX_CLEAR_STREAM_BUFFERED_EVENTS,
    });
    void this.runStream(context, command, queue);
    return queue;
  }

  private async runStream(
    context: ExecutionContextPort.IExecutionContext,
    command: ClearStreamCommand,
    queue: AsyncIterableQueue<ClearStreamEvent>
  ) {
    queue.push(this.createProgressEvent('preparing', 0, 0, 0, -1, 0, 0));

    try {
      const planResult = await this.prepareStreamPlan(context, command);
      if (planResult.isErr()) {
        queue.push(
          this.createErrorEvent(planResult.error, {
            phase: 'preparing',
            batchIndex: -1,
            totalCount: 0,
            processedCount: 0,
            clearedCount: 0,
            recordIds: [],
          })
        );
        return;
      }

      const plan = planResult.value;
      queue.push(this.createProgressEvent('preparing', plan.totalCount, 0, 0, -1, 0, 0));

      if (!plan.totalCount || !plan.targetFieldIds.length) {
        queue.push(this.createDoneEvent(0, 0, [], 0));
        return;
      }

      const operationId = context.requestId ?? generateUuid();
      const clearedFieldValues = new Map<string, unknown>(
        plan.targetFieldIds.map((fieldId) => [fieldId.toString(), null])
      );
      const operationPluginExecutionResult = await this.recordWritePluginRunner.prepare({
        kind: RecordWriteOperationKind.updateMany,
        executionContext: context,
        table: plan.table,
        orchestration: {
          mode: 'stream',
          scope: 'operation',
          operationId,
          totalRecordCount: plan.totalCount,
          totalChunkCount: plan.chunkPlans.length,
        },
        payload: {
          variant: 'selector',
          fieldValues: clearedFieldValues,
          fieldKeyType: FieldKeyType.Id,
          typecast: false,
          recordIds: [],
          recordCount: plan.totalCount,
        },
        isTransactionBound: false,
      });
      if (operationPluginExecutionResult.isErr()) {
        queue.push(
          this.createErrorEvent(operationPluginExecutionResult.error, {
            phase: 'guarding',
            batchIndex: -1,
            totalCount: plan.totalCount,
            processedCount: 0,
            clearedCount: 0,
            recordIds: [],
          })
        );
        return;
      }

      const operationPluginExecution = operationPluginExecutionResult.value;
      const operationGuardResult = await operationPluginExecution.guard();
      if (operationGuardResult.isErr()) {
        queue.push(
          this.createErrorEvent(operationGuardResult.error, {
            phase: 'guarding',
            batchIndex: -1,
            totalCount: plan.totalCount,
            processedCount: 0,
            clearedCount: 0,
            recordIds: [],
          })
        );
        return;
      }

      let processedCount = 0;
      let clearedCount = 0;
      const clearedRecordIds: string[] = [];
      let previousPluginExecution = operationPluginExecution;

      for (const chunkPlan of plan.chunkPlans) {
        const chunkRecordsResult = await this.queryClearChunkRecords(context, plan, chunkPlan);
        if (chunkRecordsResult.isErr()) {
          queue.push(
            this.createErrorEvent(chunkRecordsResult.error, {
              phase: 'clearing',
              batchIndex: chunkPlan.batchIndex,
              totalCount: plan.totalCount,
              processedCount,
              clearedCount,
              recordIds: [],
            })
          );
          continue;
        }

        const queriedRecords = chunkRecordsResult.value;
        const chunkRecordIds: RecordId[] = [];
        for (const record of queriedRecords) {
          const recordIdResult = RecordId.create(record.id);
          if (recordIdResult.isErr()) {
            queue.push(
              this.createErrorEvent(recordIdResult.error, {
                phase: 'guarding',
                batchIndex: chunkPlan.batchIndex,
                totalCount: plan.totalCount,
                processedCount,
                clearedCount,
                recordIds: [],
              })
            );
            continue;
          }
          chunkRecordIds.push(recordIdResult.value);
        }

        const chunkPluginExecutionResult = await this.recordWritePluginRunner.prepare(
          {
            kind: RecordWriteOperationKind.updateMany,
            executionContext: context,
            table: plan.table,
            orchestration: {
              mode: 'stream',
              scope: 'chunk',
              operationId,
              totalRecordCount: plan.totalCount,
              totalChunkCount: plan.chunkPlans.length,
              chunkIndex: chunkPlan.batchIndex,
            },
            payload: {
              variant: 'selector',
              fieldValues: clearedFieldValues,
              fieldKeyType: FieldKeyType.Id,
              typecast: false,
              recordIds: chunkRecordIds,
              recordCount: chunkRecordIds.length,
            },
            isTransactionBound: false,
          },
          { previousExecution: previousPluginExecution }
        );
        if (chunkPluginExecutionResult.isErr()) {
          queue.push(
            this.createErrorEvent(chunkPluginExecutionResult.error, {
              phase: 'guarding',
              batchIndex: chunkPlan.batchIndex,
              totalCount: plan.totalCount,
              processedCount,
              clearedCount,
              recordIds: chunkRecordIds.map((recordId) => recordId.toString()),
            })
          );
          processedCount += queriedRecords.length;
          continue;
        }

        const chunkPluginExecution = chunkPluginExecutionResult.value;
        const chunkGuardResult = await chunkPluginExecution.guard();
        if (chunkGuardResult.isErr()) {
          queue.push(
            this.createErrorEvent(chunkGuardResult.error, {
              phase: 'guarding',
              batchIndex: chunkPlan.batchIndex,
              totalCount: plan.totalCount,
              processedCount,
              clearedCount,
              recordIds: chunkRecordIds.map((recordId) => recordId.toString()),
            })
          );
          processedCount += queriedRecords.length;
          continue;
        }
        previousPluginExecution = chunkPluginExecution;

        const chunkBuildResult = await this.buildClearChunkPayload(
          plan.table,
          queriedRecords,
          plan.targetFieldIds,
          chunkPluginExecution
        );
        if (chunkBuildResult.isErr()) {
          queue.push(
            this.createErrorEvent(chunkBuildResult.error, {
              phase: 'guarding',
              batchIndex: chunkPlan.batchIndex,
              totalCount: plan.totalCount,
              processedCount,
              clearedCount,
              recordIds: chunkRecordIds.map((recordId) => recordId.toString()),
            })
          );
          processedCount += queriedRecords.length;
          continue;
        }

        const chunkBuild = chunkBuildResult.value;
        const batchMutation = {
          operationId,
          groupId: operationId,
          totalRecordCount: plan.totalCount,
          totalChunkCount: plan.chunkPlans.length,
          chunkIndex: chunkPlan.batchIndex,
          scope: 'chunk' as const,
        };

        let chunkClearedCount = 0;
        if (chunkBuild.updateItems.length > 0) {
          const persistResult = await this.unitOfWork.withTransaction(
            context,
            async (txContext) => {
              const txContextWithBatchMutation = withBatchMutation(txContext, batchMutation);
              const beforePersistResult = await chunkPluginExecution.beforePersist(
                txContextWithBatchMutation
              );
              if (beforePersistResult.isErr()) {
                return err(beforePersistResult.error);
              }
              return this.executeUpdates(
                txContextWithBatchMutation,
                plan.table,
                chunkBuild.updateItems
              );
            }
          );
          if (persistResult.isErr()) {
            queue.push(
              this.createErrorEvent(persistResult.error, {
                phase: 'clearing',
                batchIndex: chunkPlan.batchIndex,
                totalCount: plan.totalCount,
                processedCount,
                clearedCount,
                recordIds: chunkBuild.recordIds.map((recordId) => recordId.toString()),
              })
            );
            processedCount += queriedRecords.length;
            continue;
          }

          const persistedEventData = reconcilePersistedUpdateEvents(
            chunkBuild.eventData,
            persistResult.value
          );

          if (persistedEventData.length > 0) {
            const publishResult = await this.eventBus.publishMany(context, [
              RecordsBatchUpdated.create({
                tableId: plan.table.id(),
                baseId: plan.table.baseId(),
                updates: persistedEventData,
                source: 'user',
                orchestration: batchMutation,
              }),
            ]);
            if (publishResult.isErr()) {
              queue.push(
                this.createErrorEvent(publishResult.error, {
                  phase: 'publishing',
                  batchIndex: chunkPlan.batchIndex,
                  totalCount: plan.totalCount,
                  processedCount,
                  clearedCount,
                  recordIds: chunkBuild.recordIds.map((recordId) => recordId.toString()),
                })
              );
            }
          }

          if (persistedEventData.length > 0) {
            const tableIdText = plan.table.id().toString();
            const undoRedoResult = await this.undoRedoStackService.appendEntry(
              toUndoRedoStackAppendContext(context),
              plan.table.id(),
              {
                groupId: operationId,
                undoCommand: buildUpdateRecordsUndoRedoCommand(
                  tableIdText,
                  persistedEventData,
                  (change) => change.oldValue
                ),
                redoCommand: buildUpdateRecordsUndoRedoCommand(
                  tableIdText,
                  persistedEventData,
                  (change) => change.newValue
                ),
              }
            );
            if (undoRedoResult.isErr()) {
              queue.push(
                this.createErrorEvent(undoRedoResult.error, {
                  phase: 'finalizing',
                  batchIndex: chunkPlan.batchIndex,
                  totalCount: plan.totalCount,
                  processedCount,
                  clearedCount,
                  recordIds: chunkBuild.recordIds.map((recordId) => recordId.toString()),
                })
              );
            }
          }

          chunkClearedCount = persistResult.value.totalUpdated;
          clearedCount += chunkClearedCount;
          clearedRecordIds.push(...persistedEventData.map((update) => update.recordId));
        }

        await chunkPluginExecution.afterCommit();
        processedCount += queriedRecords.length;
        queue.push(
          this.createProgressEvent(
            'clearing',
            plan.totalCount,
            processedCount,
            clearedCount,
            chunkPlan.batchIndex,
            queriedRecords.length,
            chunkClearedCount
          )
        );
      }

      queue.push(
        this.createDoneEvent(plan.totalCount, processedCount, clearedRecordIds, clearedCount)
      );
    } catch (error) {
      queue.push(
        this.createErrorEvent(domainError.fromUnknown(error, { code: 'clear_stream.failed' }), {
          phase: 'clearing',
          batchIndex: -1,
          totalCount: 0,
          processedCount: 0,
          clearedCount: 0,
          recordIds: [],
        })
      );
    } finally {
      queue.close();
    }
  }

  private async prepareStreamPlan(
    context: ExecutionContextPort.IExecutionContext,
    command: ClearStreamCommand
  ): Promise<Result<PreparedClearStreamPlan, DomainError>> {
    const tableResult = await this.tableQueryService.getById(context, command.tableId);
    if (tableResult.isErr()) {
      return err(tableResult.error);
    }
    const table = tableResult.value;

    const orderedFieldIdsResult = await table.getOrderedVisibleFieldIds(command.viewId.toString(), {
      projection: command.projection,
    });
    if (orderedFieldIdsResult.isErr()) {
      return err(orderedFieldIdsResult.error);
    }

    const viewResult = await table.getView(command.viewId);
    if (viewResult.isErr()) {
      return err(viewResult.error);
    }
    const viewDefaultsResult = await viewResult.value.queryDefaults();
    if (viewDefaultsResult.isErr()) {
      return err(viewDefaultsResult.error);
    }
    const mergedDefaults = viewDefaultsResult.value.merge({
      filter: command.filter,
      sort: command.sort,
      group: command.groupBy,
    });

    const effectiveFilter = command.ignoreViewQuery
      ? command.filter ?? undefined
      : mergedDefaults.filter() ?? undefined;
    const effectiveSort = command.ignoreViewQuery
      ? command.sort ?? undefined
      : mergedDefaults.sort();
    const effectiveGroup = command.ignoreViewQuery
      ? command.groupBy ?? undefined
      : mergedDefaults.group();

    const filterSpecResult = await buildSanitizedRecordConditionSpec(table, effectiveFilter);
    if (filterSpecResult.isErr()) {
      return err(filterSpecResult.error);
    }
    const filterSpec = filterSpecResult.value;

    let totalRows = 0;
    if (command.rangeType === 'columns' || command.rangeType === 'rows') {
      const limitResult = PageLimit.create(1);
      if (limitResult.isOk()) {
        const pagination = OffsetPagination.create(limitResult.value, PageOffset.zero());
        const countResult = await this.tableRecordQueryRepository.find(context, table, filterSpec, {
          mode: 'stored',
          pagination,
          search: resolveVisibleRowSearch(command.search, orderedFieldIdsResult.value),
        });
        if (countResult.isErr()) {
          return err(countResult.error);
        }
        totalRows = countResult.value.total;
      }
    }

    const normalizedRanges = command.normalizeRanges(totalRows, orderedFieldIdsResult.value.length);
    const [[startCol, startRow], [endCol, endRow]] = normalizedRanges;
    const totalCount = Math.max(0, endRow - startRow + 1);
    const targetFieldIds = orderedFieldIdsResult.value
      .slice(startCol, endCol + 1)
      .filter((fieldId) => {
        const fieldResult = table.getField((field) => field.id().equals(fieldId));
        return fieldResult.isOk() && !fieldResult.value.computed().toBoolean();
      });

    const groupByOrderByResult = await resolveGroupByToOrderBy(effectiveGroup);
    if (groupByOrderByResult.isErr()) {
      return err(groupByOrderByResult.error);
    }
    const sortOrderByResult = await resolveOrderBy(effectiveSort);
    if (sortOrderByResult.isErr()) {
      return err(sortOrderByResult.error);
    }

    const orderBy =
      mergeOrderByWithViewRowTieBreaker(
        groupByOrderByResult.value,
        sortOrderByResult.value,
        command.viewId.toString()
      ) ?? [];
    const search = resolveVisibleRowSearch(command.search, orderedFieldIdsResult.value);
    if (!totalCount || !targetFieldIds.length) {
      return ok({
        table,
        targetFieldIds,
        totalCount: 0,
        chunkPlans: [],
      });
    }

    const targetRecordsResult = await this.queryClearTargetRecords(
      context,
      table,
      filterSpec,
      orderBy,
      search,
      startRow,
      totalCount
    );
    if (targetRecordsResult.isErr()) {
      return err(targetRecordsResult.error);
    }

    const targetRecords = targetRecordsResult.value;
    const batchSize = resolveSelectionStreamBatchSize(targetRecords.length, command.batchSize);
    const chunkPlans = this.buildClearStreamChunkPlans(targetRecords, batchSize);

    return ok({
      table,
      targetFieldIds,
      totalCount: targetRecords.length,
      chunkPlans,
    });
  }

  private buildClearStreamChunkPlans(
    records: ReadonlyArray<TableRecordReadModel>,
    batchSize: number
  ): ReadonlyArray<{ batchIndex: number; records: ReadonlyArray<TableRecordReadModel> }> {
    const normalizedBatchSize = Math.max(1, batchSize);
    const chunkPlans: Array<{
      batchIndex: number;
      records: ReadonlyArray<TableRecordReadModel>;
    }> = [];

    for (let offset = 0; offset < records.length; offset += normalizedBatchSize) {
      chunkPlans.push({
        batchIndex: chunkPlans.length,
        records: records.slice(offset, offset + normalizedBatchSize),
      });
    }

    return chunkPlans;
  }

  private async queryClearTargetRecords(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    filterSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    orderBy: ReadonlyArray<TableRecordOrderBy>,
    search: ReturnType<typeof resolveVisibleRowSearch>,
    offset: number,
    limit: number
  ): Promise<Result<ReadonlyArray<TableRecordReadModel>, DomainError>> {
    const records: TableRecordReadModel[] = [];
    const stream = this.tableRecordQueryRepository.findStream(context, table, filterSpec, {
      mode: 'stored',
      pagination: { offset, limit },
      orderBy,
      search,
    });

    for await (const recordResult of stream) {
      if (recordResult.isErr()) {
        return err(recordResult.error);
      }
      records.push(recordResult.value);
    }

    return ok(records);
  }

  private async queryClearChunkRecords(
    _context: ExecutionContextPort.IExecutionContext,
    _plan: PreparedClearStreamPlan,
    chunkPlan: { records: ReadonlyArray<TableRecordReadModel> }
  ): Promise<Result<ReadonlyArray<TableRecordReadModel>, DomainError>> {
    return ok(chunkPlan.records);
  }

  private async buildClearChunkPayload(
    table: Table,
    records: ReadonlyArray<TableRecordReadModel>,
    targetFieldIds: ReadonlyArray<FieldId>,
    pluginExecution: RecordWritePluginExecution
  ): Promise<Result<ClearChunkBuildResult, DomainError>> {
    const pluginRecordSpecResult = await pluginExecution.getRecordSpec();
    if (pluginRecordSpecResult.isErr()) {
      return err(pluginRecordSpecResult.error);
    }

    const updateItems: UpdateRecordItem[] = [];
    const eventData: RecordUpdateDTO[] = [];
    const recordIds: RecordId[] = [];

    for (const record of records) {
      const tableRecordResult = await toTableRecord(table, record);
      if (tableRecordResult.isErr()) {
        return err(tableRecordResult.error);
      }
      const tableRecord = tableRecordResult.value;
      if (
        pluginRecordSpecResult.value &&
        !pluginRecordSpecResult.value.isSatisfiedBy(tableRecord)
      ) {
        continue;
      }

      const allowedFieldIds = await pluginExecution.getUpdateFieldIdsForRecord(tableRecord);
      if (allowedFieldIds.isErr()) {
        return err(allowedFieldIds.error);
      }
      const recordScopedEditableFieldIds = filterScopedFieldIds(
        targetFieldIds,
        allowedFieldIds.value
      );
      if (!recordScopedEditableFieldIds.length) {
        continue;
      }

      const recordIdResult = RecordId.create(record.id);
      if (recordIdResult.isErr()) {
        return err(recordIdResult.error);
      }

      const fieldValues = new Map<string, unknown>();
      const changes: RecordFieldChangeDTO[] = [];
      for (const fieldId of recordScopedEditableFieldIds) {
        const fieldIdStr = fieldId.toString();
        const oldValue = record.fields[fieldIdStr];
        const newValue = null;
        if (areRecordFieldValuesEqual(oldValue, newValue)) {
          continue;
        }
        fieldValues.set(fieldIdStr, newValue);
        changes.push({
          fieldId: fieldIdStr,
          oldValue,
          newValue,
        });
      }

      if (changes.length === 0) {
        continue;
      }

      recordIds.push(recordIdResult.value);
      updateItems.push({
        recordId: recordIdResult.value,
        fieldValues,
      });
      eventData.push({
        recordId: record.id,
        oldVersion: record.version,
        newVersion: record.version + 1,
        changes,
      });
    }

    return ok({
      updateItems,
      eventData,
      recordIds,
    });
  }

  private createProgressEvent(
    phase: ClearStreamProgressEvent['phase'],
    totalCount: number,
    processedCount: number,
    clearedCount: number,
    batchIndex: number,
    batchProcessedCount: number,
    batchClearedCount: number
  ): ClearStreamProgressEvent {
    return {
      id: 'progress',
      phase,
      batchIndex,
      totalCount,
      processedCount,
      clearedCount,
      batchProcessedCount,
      batchClearedCount,
    };
  }

  private createDoneEvent(
    totalCount: number,
    processedCount: number,
    clearedRecordIds: ReadonlyArray<string>,
    clearedCount: number
  ): ClearStreamDoneEvent {
    return {
      id: 'done',
      totalCount,
      processedCount,
      clearedCount,
      data: {
        clearedCount,
        clearedRecordIds: [...clearedRecordIds],
      },
    };
  }

  private createErrorEvent(
    error: DomainError,
    details: {
      phase: ClearStreamErrorEvent['phase'];
      batchIndex: number;
      totalCount: number;
      processedCount: number;
      clearedCount: number;
      recordIds: string[];
    }
  ): ClearStreamErrorEvent {
    return {
      id: 'error',
      phase: details.phase,
      batchIndex: details.batchIndex,
      totalCount: details.totalCount,
      processedCount: details.processedCount,
      clearedCount: details.clearedCount,
      recordIds: [...details.recordIds],
      message: error.message,
      code: error.code,
    };
  }
}

export type ClearStreamResult = AsyncIterable<ClearStreamEvent>;

@CommandHandler(ClearStreamCommand)
@injectable()
export class ClearStreamHandler implements ICommandHandler<ClearStreamCommand, ClearStreamResult> {
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.recordWritePluginRunner)
    private readonly recordWritePluginRunner: RecordWritePluginRunner,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoStackService: UndoRedoStackService,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: ClearStreamCommand
  ): Promise<Result<ClearStreamResult, DomainError>> {
    return ok(
      new ClearStreamApplicationService(
        this.tableQueryService,
        this.recordWritePluginRunner,
        this.tableRecordRepository,
        this.tableRecordQueryRepository,
        this.eventBus,
        this.undoRedoStackService,
        this.unitOfWork
      ).createStream(context, command)
    );
  }
}
