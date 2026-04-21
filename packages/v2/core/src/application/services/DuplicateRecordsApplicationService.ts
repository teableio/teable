import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { RecordGroupByValue } from '../../commands/DeleteByRangeCommand';
import { normalizeRanges, type RangeType } from '../../commands/RangeUtils';
import { buildOperationBatchMutation } from '../../commands/shared/batchMutationOrchestration';
import { yieldToEventLoop } from '../../commands/shared/cooperativeYield';
import {
  mergeOrderByWithViewRowTieBreaker,
  resolveGroupByToOrderBy,
  resolveOrderBy,
} from '../../commands/shared/orderBy';
import { resolveSelectionStreamBatchSize } from '../../commands/shared/streamBatchSize';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { generateUuid } from '../../domain/shared/IdGenerator';
import { OffsetPagination } from '../../domain/shared/pagination/OffsetPagination';
import { PageLimit } from '../../domain/shared/pagination/PageLimit';
import { PageOffset } from '../../domain/shared/pagination/PageOffset';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import { RecordsBatchCreated } from '../../domain/table/events/RecordsBatchCreated';
import { RecordId } from '../../domain/table/records/RecordId';
import { RecordInsertOrder } from '../../domain/table/records/RecordInsertOrder';
import { recordToFieldValues } from '../../domain/table/records/recordToFieldValues';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import type { Table } from '../../domain/table/Table';
import type { TableId } from '../../domain/table/TableId';
import type { ViewId } from '../../domain/table/views/ViewId';
import * as EventBusPort from '../../ports/EventBus';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { AsyncIterableQueue } from '../../ports/memory/AsyncIterableQueue';
import {
  RecordWriteOperationKind,
  type RecordWriteFieldValues,
} from '../../ports/RecordWritePlugin';
import { ITableRecordQueryRepository } from '../../ports/TableRecordQueryRepository';
import type { TableRecordOrderBy } from '../../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import { ITableRecordRepository } from '../../ports/TableRecordRepository';
import type {
  BatchRecordMutationResult,
  RecordStoredSnapshot,
} from '../../ports/TableRecordRepository';
import { v2CoreTokens } from '../../ports/tokens';
import type { SpanAttributes } from '../../ports/Tracer';
import * as UnitOfWorkPort from '../../ports/UnitOfWork';
import type { RecordSortValue } from '../../queries/ListTableRecordsQuery';
import type { RecordFilter } from '../../queries/RecordFilterDto';
import { buildSanitizedRecordConditionSpec } from '../../queries/RecordFilterMapper';
import {
  resolveVisibleRowSearch,
  type RecordQuerySearch,
  type RecordSearch,
} from '../../queries/RecordSearch';
import { requireStoredRecordSnapshots } from './RecordMutationSnapshotContract';
import {
  RecordWritePluginRunner,
  type RecordWritePluginExecution,
} from './RecordWritePluginRunner';
import { RecordWriteSideEffectService } from './RecordWriteSideEffectService';
import { TableQueryService } from './TableQueryService';
import { TableUpdateFlow } from './TableUpdateFlow';
import { toUndoRedoStackAppendContext, UndoRedoStackService } from './UndoRedoStackService';

const MAX_DUPLICATE_STREAM_BUFFERED_EVENTS = 64;

type DuplicateRecordsStreamCommandLike = {
  readonly tableId: TableId;
  readonly viewId: ViewId;
  readonly rawRanges: ReadonlyArray<readonly [number, number]>;
  readonly rangeType: RangeType;
  readonly filter: RecordFilter | undefined;
  readonly sort: ReadonlyArray<RecordSortValue> | undefined;
  readonly search: RecordSearch | undefined;
  readonly groupBy: ReadonlyArray<RecordGroupByValue> | undefined;
  readonly ignoreViewQuery: boolean;
  readonly batchSize?: number;
};

type PreparedDuplicateSourceRecord = {
  readonly sourceRecordId: RecordId;
  readonly sourceRecordIdString: string;
  readonly fieldValues: RecordWriteFieldValues;
};

type PreparedDuplicatePlan = {
  readonly table: Table;
  readonly viewId: ViewId;
  readonly totalCount: number;
  readonly batchSize: number;
  readonly chunkPlans: ReadonlyArray<PreparedDuplicateChunk>;
  readonly anchorRecordId?: RecordId;
};

type PreparedDuplicateChunk = {
  readonly batchIndex: number;
  readonly sourceRecords: ReadonlyArray<PreparedDuplicateSourceRecord>;
};

type DuplicatePluginOrchestration = {
  readonly mode: 'stream';
  readonly scope: 'operation' | 'chunk';
  readonly operationId: string;
  readonly totalRecordCount: number;
  readonly totalChunkCount: number;
  readonly chunkIndex?: number;
};

type DuplicateChunkPersistResult = {
  readonly duplicatedRecordIds: ReadonlyArray<string>;
  readonly storedSnapshots: ReadonlyArray<RecordStoredSnapshot>;
  readonly events: ReadonlyArray<IDomainEvent>;
};

type DuplicateRecordsStreamExecutionResult = {
  readonly duplicatedCount: number;
  readonly duplicatedRecordIds: ReadonlyArray<string>;
};

export interface DuplicateRecordsStreamProgressEvent {
  id: 'progress';
  phase: 'preparing' | 'duplicating';
  batchIndex: number;
  totalCount: number;
  duplicatedCount: number;
  batchDuplicatedCount: number;
}

export interface DuplicateRecordsStreamDoneEvent {
  id: 'done';
  totalCount: number;
  duplicatedCount: number;
  data: {
    duplicatedCount: number;
    duplicatedRecordIds: string[];
  };
}

export interface DuplicateRecordsStreamErrorEvent {
  id: 'error';
  phase: 'preparing' | 'guarding' | 'duplicating' | 'publishing' | 'finalizing';
  batchIndex: number;
  totalCount: number;
  duplicatedCount: number;
  recordIds: string[];
  message: string;
  code?: string;
}

export type DuplicateRecordsStreamEvent =
  | DuplicateRecordsStreamProgressEvent
  | DuplicateRecordsStreamDoneEvent
  | DuplicateRecordsStreamErrorEvent;

@injectable()
export class DuplicateRecordsApplicationService {
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.recordWritePluginRunner)
    private readonly recordWritePluginRunner: RecordWritePluginRunner,
    @inject(v2CoreTokens.recordWriteSideEffectService)
    private readonly recordWriteSideEffectService: RecordWriteSideEffectService,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: ITableRecordRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: ITableRecordQueryRepository,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoStackService: UndoRedoStackService,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  createStream(
    context: IExecutionContext,
    command: DuplicateRecordsStreamCommandLike
  ): AsyncIterable<DuplicateRecordsStreamEvent> {
    const queue = new AsyncIterableQueue<DuplicateRecordsStreamEvent>({
      maxBufferedItems: MAX_DUPLICATE_STREAM_BUFFERED_EVENTS,
    });
    void this.runDuplicateStream(context, command, queue);
    return queue;
  }

  private async runDuplicateStream(
    context: IExecutionContext,
    command: DuplicateRecordsStreamCommandLike,
    queue: AsyncIterableQueue<DuplicateRecordsStreamEvent>
  ) {
    if (!queue.push(this.createProgressEvent('preparing', 0, 0, 0, -1))) {
      return;
    }

    try {
      const planResult = await this.prepareDuplicatePlan(context, command);
      if (planResult.isErr()) {
        queue.push(
          this.createErrorEvent(planResult.error, {
            phase: 'preparing',
            batchIndex: -1,
            totalCount: 0,
            duplicatedCount: 0,
            recordIds: [],
          })
        );
        return;
      }

      const plan = planResult.value;
      queue.push(this.createProgressEvent('preparing', plan.totalCount, 0, 0, -1));

      if (!plan.totalCount) {
        queue.push(
          this.createDoneEvent(
            {
              duplicatedCount: 0,
              duplicatedRecordIds: [],
            },
            0
          )
        );
        return;
      }

      const operationId = context.requestId ?? generateUuid();
      const executeResult = await this.executeDuplicateStreamChunks(context, plan, queue, {
        operationId,
        totalChunkCount: plan.chunkPlans.length,
      });
      if (executeResult.isErr()) {
        queue.push(
          this.createErrorEvent(executeResult.error, {
            phase: 'duplicating',
            batchIndex: -1,
            totalCount: plan.totalCount,
            duplicatedCount: 0,
            recordIds: [],
          })
        );
        return;
      }

      const executeSummary = executeResult.value;
      queue.push(
        this.createDoneEvent(
          {
            duplicatedCount: executeSummary.duplicatedCount,
            duplicatedRecordIds: executeSummary.duplicatedRecordIds,
          },
          plan.totalCount
        )
      );
    } catch (error) {
      queue.push(
        this.createErrorEvent(
          domainError.fromUnknown(error, {
            code: 'duplicate_records_stream.failed',
          }),
          {
            phase: 'duplicating',
            batchIndex: -1,
            totalCount: 0,
            duplicatedCount: 0,
            recordIds: [],
          }
        )
      );
    } finally {
      queue.close();
    }
  }

  private async prepareDuplicatePlan(
    context: IExecutionContext,
    command: DuplicateRecordsStreamCommandLike
  ): Promise<Result<PreparedDuplicatePlan, DomainError>> {
    const tableResult = await this.tableQueryService.getById(context, command.tableId);
    if (tableResult.isErr()) {
      return err(tableResult.error);
    }
    const table = tableResult.value;

    const orderedFieldIdsResult = await table.getOrderedVisibleFieldIds(command.viewId.toString());
    if (orderedFieldIdsResult.isErr()) {
      return err(orderedFieldIdsResult.error);
    }

    const viewResult = await table.getView(command.viewId);
    if (viewResult.isErr()) {
      return err(viewResult.error);
    }
    const view = viewResult.value;

    const viewDefaultsResult = await view.queryDefaults();
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

    const visibleRowSearch = resolveVisibleRowSearch(command.search, orderedFieldIdsResult.value);
    const groupByOrderByResult = await resolveGroupByToOrderBy(effectiveGroup);
    if (groupByOrderByResult.isErr()) {
      return err(groupByOrderByResult.error);
    }
    const sortOrderByResult = await resolveOrderBy(effectiveSort);
    if (sortOrderByResult.isErr()) {
      return err(sortOrderByResult.error);
    }

    const orderBy = mergeOrderByWithViewRowTieBreaker(
      groupByOrderByResult.value,
      sortOrderByResult.value,
      command.viewId.toString()
    );

    const totalRowsResult = await this.countRecordsInScope(
      context,
      table,
      filterSpec,
      orderBy,
      visibleRowSearch
    );
    if (totalRowsResult.isErr()) {
      return err(totalRowsResult.error);
    }

    const rowRanges = this.resolveDuplicateStreamRowRanges(
      command,
      totalRowsResult.value,
      orderedFieldIdsResult.value.length
    );
    const totalCount = rowRanges.reduce(
      (sum, [startRow, endRow]) => sum + (endRow - startRow + 1),
      0
    );
    const batchSize = resolveSelectionStreamBatchSize(totalCount, command.batchSize);
    const sourceRecordsResult = await this.collectDuplicateSourceRecords(
      context,
      table,
      filterSpec,
      orderBy,
      visibleRowSearch,
      rowRanges,
      batchSize
    );
    if (sourceRecordsResult.isErr()) {
      return err(sourceRecordsResult.error);
    }

    const sourceRecords = sourceRecordsResult.value;
    const chunkPlans = this.buildDuplicateChunkPlans(sourceRecords, batchSize);
    const anchorRecordIdResult = await this.resolveDuplicateAnchorRecordId(
      context,
      table,
      filterSpec,
      orderBy,
      visibleRowSearch,
      rowRanges.at(-1)?.[1]
    );
    if (anchorRecordIdResult.isErr()) {
      return err(anchorRecordIdResult.error);
    }

    return ok({
      table,
      viewId: command.viewId,
      totalCount: sourceRecords.length,
      batchSize,
      chunkPlans,
      anchorRecordId: anchorRecordIdResult.value,
    });
  }

  private extractDuplicateFieldValues(
    table: Table,
    record: Pick<TableRecordReadModel, 'fields'>
  ): RecordWriteFieldValues {
    const fieldValues = new Map<string, unknown>();

    for (const field of table.getFields()) {
      if (field.computed().toBoolean()) {
        continue;
      }

      const fieldId = field.id().toString();
      const value = record.fields[fieldId];
      if (value !== null && value !== undefined) {
        fieldValues.set(fieldId, value);
      }
    }

    return fieldValues;
  }

  private async countRecordsInScope(
    context: IExecutionContext,
    table: Table,
    filterSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    orderBy: ReadonlyArray<TableRecordOrderBy> | undefined,
    search: RecordQuerySearch | undefined
  ): Promise<Result<number, DomainError>> {
    const countLimitResult = PageLimit.create(1);
    if (countLimitResult.isErr()) {
      return ok(0);
    }

    const countResult = await this.tableRecordQueryRepository.find(context, table, filterSpec, {
      mode: 'stored',
      pagination: OffsetPagination.create(countLimitResult.value, PageOffset.zero()),
      orderBy,
      search,
    });
    if (countResult.isErr()) {
      return err(countResult.error);
    }

    return ok(countResult.value.total);
  }

  private async queryRecordsForRange(
    context: IExecutionContext,
    table: Table,
    filterSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    orderBy: ReadonlyArray<TableRecordOrderBy> | undefined,
    search: RecordQuerySearch | undefined,
    start: number,
    end: number,
    options?: {
      includeTotal?: boolean;
    }
  ): Promise<Result<ReadonlyArray<TableRecordReadModel>, DomainError>> {
    const count = end - start + 1;
    if (count <= 0) {
      return ok([]);
    }

    const limitResult = PageLimit.create(count);
    if (limitResult.isErr()) {
      return ok([]);
    }

    const offsetResult = PageOffset.create(start);
    if (offsetResult.isErr()) {
      return ok([]);
    }

    const pagination = OffsetPagination.create(limitResult.value, offsetResult.value);
    const queryResult = await this.tableRecordQueryRepository.find(context, table, filterSpec, {
      mode: 'stored',
      pagination,
      orderBy,
      search,
      includeTotal: options?.includeTotal,
    });
    if (queryResult.isErr()) {
      return err(queryResult.error);
    }

    return ok(queryResult.value.records);
  }

  private async prepareDuplicatePluginExecution(
    context: IExecutionContext,
    table: Table,
    chunk: PreparedDuplicateChunk,
    batchSize: number,
    order: RecordInsertOrder | undefined,
    orchestration: DuplicatePluginOrchestration,
    previousExecution?: RecordWritePluginExecution,
    payloadRecordCount?: number
  ): Promise<Result<RecordWritePluginExecution | undefined, DomainError>> {
    const pluginExecutionResult = await this.recordWritePluginRunner.prepare(
      {
        kind: RecordWriteOperationKind.duplicateStream,
        executionContext: context,
        table,
        orchestration,
        payload: {
          sourceRecordIds: chunk.sourceRecords.map((record) => record.sourceRecordId),
          recordsFieldValues: chunk.sourceRecords.map((record) => record.fieldValues),
          batchSize,
          order,
          recordCount: payloadRecordCount ?? chunk.sourceRecords.length,
        },
        isTransactionBound: false,
      },
      { previousExecution }
    );
    if (pluginExecutionResult.isErr()) {
      return err(pluginExecutionResult.error);
    }

    const pluginExecution = pluginExecutionResult.value;
    const guardResult = await pluginExecution.guard();
    if (guardResult.isErr()) {
      return err(guardResult.error);
    }

    return ok(pluginExecution);
  }

  private resolveDuplicateStreamRowRanges(
    command: DuplicateRecordsStreamCommandLike,
    totalRows: number,
    totalCols: number
  ): ReadonlyArray<readonly [number, number]> {
    if (totalRows <= 0) {
      return [];
    }

    const rowRanges =
      command.rangeType === 'rows'
        ? command.rawRanges
            .map(([startRow, endRow]) => this.clampDuplicateRowRange(startRow, endRow, totalRows))
            .filter((range): range is readonly [number, number] => Boolean(range))
        : (() => {
            const [[, startRow], [, endRow]] = normalizeRanges(
              command.rawRanges,
              command.rangeType,
              totalRows,
              totalCols
            );
            const normalizedRange = this.clampDuplicateRowRange(startRow, endRow, totalRows);
            return normalizedRange ? [normalizedRange] : [];
          })();

    return [...rowRanges].sort((left, right) => {
      if (left[0] !== right[0]) {
        return left[0] - right[0];
      }

      return left[1] - right[1];
    });
  }

  private clampDuplicateRowRange(
    startRow: number,
    endRow: number,
    totalRows: number
  ): readonly [number, number] | null {
    if (totalRows <= 0) {
      return null;
    }

    const normalizedStart = Math.max(0, Math.min(startRow, endRow));
    const normalizedEnd = Math.min(totalRows - 1, Math.max(startRow, endRow));
    if (normalizedEnd < normalizedStart) {
      return null;
    }

    return [normalizedStart, normalizedEnd] as const;
  }

  private async collectDuplicateSourceRecords(
    context: IExecutionContext,
    table: Table,
    filterSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    orderBy: ReadonlyArray<TableRecordOrderBy> | undefined,
    search: RecordQuerySearch | undefined,
    rowRanges: ReadonlyArray<readonly [number, number]>,
    pageSize: number
  ): Promise<Result<ReadonlyArray<PreparedDuplicateSourceRecord>, DomainError>> {
    const sourceRecords: PreparedDuplicateSourceRecord[] = [];
    const normalizedPageSize = Math.max(1, pageSize);

    for (const [startRow, endRow] of rowRanges) {
      for (let cursor = startRow; cursor <= endRow; cursor += normalizedPageSize) {
        const pageEnd = Math.min(endRow, cursor + normalizedPageSize - 1);
        const recordsResult = await this.queryRecordsForRange(
          context,
          table,
          filterSpec,
          orderBy,
          search,
          cursor,
          pageEnd,
          { includeTotal: false }
        );
        if (recordsResult.isErr()) {
          return err(recordsResult.error);
        }

        for (const record of recordsResult.value) {
          const recordIdResult = RecordId.create(record.id);
          if (recordIdResult.isErr()) {
            return err(recordIdResult.error);
          }

          sourceRecords.push({
            sourceRecordId: recordIdResult.value,
            sourceRecordIdString: record.id,
            fieldValues: this.extractDuplicateFieldValues(table, record),
          });
        }
      }
    }

    return ok(sourceRecords);
  }

  private buildDuplicateChunkPlans(
    sourceRecords: ReadonlyArray<PreparedDuplicateSourceRecord>,
    batchSize: number
  ): ReadonlyArray<PreparedDuplicateChunk> {
    const chunkPlans: PreparedDuplicateChunk[] = [];
    const normalizedBatchSize = Math.max(1, batchSize);

    for (let offset = 0; offset < sourceRecords.length; offset += normalizedBatchSize) {
      chunkPlans.push({
        batchIndex: chunkPlans.length,
        sourceRecords: sourceRecords.slice(offset, offset + normalizedBatchSize),
      });
    }

    return chunkPlans;
  }

  private async resolveDuplicateAnchorRecordId(
    context: IExecutionContext,
    table: Table,
    filterSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    orderBy: ReadonlyArray<TableRecordOrderBy> | undefined,
    search: RecordQuerySearch | undefined,
    anchorRow: number | undefined
  ): Promise<Result<RecordId | undefined, DomainError>> {
    if (anchorRow === undefined) {
      return ok(undefined);
    }

    const recordsResult = await this.queryRecordsForRange(
      context,
      table,
      filterSpec,
      orderBy,
      search,
      anchorRow,
      anchorRow,
      { includeTotal: false }
    );
    if (recordsResult.isErr()) {
      return err(recordsResult.error);
    }

    const anchorRecord = recordsResult.value.at(0);
    if (!anchorRecord) {
      return ok(undefined);
    }

    return RecordId.create(anchorRecord.id).map((recordId) => recordId);
  }

  private async duplicateChunkInSingleTransaction(
    context: IExecutionContext,
    table: Table,
    chunk: PreparedDuplicateChunk,
    order: RecordInsertOrder | undefined,
    pluginExecution?: RecordWritePluginExecution,
    orchestration?: {
      operationId: string;
      totalRecordCount: number;
      totalChunkCount: number;
      chunkIndex: number;
    }
  ): Promise<Result<DuplicateChunkPersistResult, DomainError>> {
    const sourceFieldValues = chunk.sourceRecords.map((record) => record.fieldValues);
    const traceAttributes = {
      'teable.batch_index': chunk.batchIndex,
      'teable.chunk_record_count': chunk.sourceRecords.length,
      'teable.total_record_count': orchestration?.totalRecordCount ?? chunk.sourceRecords.length,
      'teable.table_id': table.id().toString(),
    } satisfies SpanAttributes;
    const sideEffectResult = await this.runInSpan(
      context,
      'teable.DuplicateRecordsApplicationService.prepareDuplicateChunkMutation',
      traceAttributes,
      async () =>
        this.recordWriteSideEffectService.execute(context, table, sourceFieldValues, false)
    );
    if (sideEffectResult.isErr()) {
      return err(sideEffectResult.error);
    }

    const tableForCreate = sideEffectResult.value.table;
    const createResult = await this.runInSpan(
      context,
      'teable.DuplicateRecordsApplicationService.buildDuplicateChunkRecords',
      traceAttributes,
      async () =>
        tableForCreate.createRecords(sourceFieldValues, {
          typecast: false,
          valuesAreValidated: true,
          emitRecordCreatedEvents: false,
        })
    );
    if (createResult.isErr()) {
      return err(createResult.error);
    }

    const transactionResult = await this.runInSpan(
      context,
      'teable.DuplicateRecordsApplicationService.persistDuplicateChunkMutation',
      traceAttributes,
      () =>
        this.unitOfWork.withTransaction(context, async (transactionContext) => {
          const transactionContextWithBatchMutation = orchestration
            ? {
                ...transactionContext,
                batchMutation: {
                  operationId: orchestration.operationId,
                  groupId: orchestration.operationId,
                  totalRecordCount: orchestration.totalRecordCount,
                  totalChunkCount: orchestration.totalChunkCount,
                  chunkIndex: orchestration.chunkIndex,
                  scope: 'chunk' as const,
                },
              }
            : {
                ...transactionContext,
                batchMutation: buildOperationBatchMutation(context, chunk.sourceRecords.length),
              };
          let tableEvents: ReadonlyArray<IDomainEvent> = [];
          const updateResult = sideEffectResult.value.updateResult;
          if (updateResult) {
            const tableFlowResult = await this.tableUpdateFlow.execute(
              transactionContextWithBatchMutation,
              { table },
              () => ok(updateResult),
              { publishEvents: false }
            );
            if (tableFlowResult.isErr()) {
              return err(tableFlowResult.error);
            }
            tableEvents = tableFlowResult.value.events;
          }

          if (pluginExecution) {
            const beforePersistResult = await pluginExecution.beforePersist(
              transactionContextWithBatchMutation
            );
            if (beforePersistResult.isErr()) {
              return err(beforePersistResult.error);
            }
          }

          const insertResult = await this.tableRecordRepository.insertMany(
            transactionContextWithBatchMutation,
            tableForCreate,
            createResult.value.records,
            order ? { order } : undefined
          );
          if (insertResult.isErr()) {
            return err(insertResult.error);
          }

          return ok({
            tableEvents,
            mutationResult: insertResult.value,
            records: createResult.value.records,
          });
        })
    );
    if (transactionResult.isErr()) {
      return err(transactionResult.error);
    }

    const persisted = transactionResult.value;
    const events = await this.runInSpan(
      context,
      'teable.DuplicateRecordsApplicationService.aggregateDuplicateChunkEvents',
      traceAttributes,
      async () => [
        ...persisted.tableEvents,
        ...this.aggregateCreatedEvents(table, persisted.mutationResult, persisted.records, {
          operationId: orchestration?.operationId,
          groupId: orchestration?.operationId,
          totalRecordCount: orchestration?.totalRecordCount ?? persisted.records.length,
          totalChunkCount: orchestration?.totalChunkCount ?? 1,
          chunkIndex: orchestration?.chunkIndex ?? 0,
          scope: 'chunk',
        }),
      ]
    );
    const storedSnapshotsResult = await this.buildStoredSnapshots(
      context,
      table,
      persisted.records,
      persisted.mutationResult
    );
    if (storedSnapshotsResult.isErr()) {
      return err(storedSnapshotsResult.error);
    }

    return ok({
      duplicatedRecordIds: persisted.records.map((record) => record.id().toString()),
      storedSnapshots: storedSnapshotsResult.value,
      events,
    });
  }

  private aggregateCreatedEvents(
    table: Table,
    mutationResult: BatchRecordMutationResult,
    records: ReadonlyArray<TableRecord>,
    orchestration?: {
      operationId?: string;
      groupId?: string;
      totalRecordCount: number;
      totalChunkCount: number;
      chunkIndex: number;
      scope: 'operation' | 'chunk';
    }
  ): ReadonlyArray<IDomainEvent> {
    if (!records.length) {
      return [];
    }
    return [
      RecordsBatchCreated.create({
        tableId: table.id(),
        baseId: table.baseId(),
        records: records.map((record) => ({
          recordId: record.id().toString(),
          fields: recordToFieldValues(record),
          orders: mutationResult.recordOrders?.get(record.id().toString()),
        })),
        source: { type: 'user' },
        orchestration,
      }),
    ];
  }

  private async buildStoredSnapshots(
    _context: IExecutionContext,
    table: Table,
    records: ReadonlyArray<TableRecord>,
    mutationResult: BatchRecordMutationResult
  ): Promise<Result<ReadonlyArray<RecordStoredSnapshot>, DomainError>> {
    const storedSnapshotsResult = requireStoredRecordSnapshots(
      {
        operation: 'duplicate',
        tableId: table.id().toString(),
        expectedCount: records.length,
      },
      mutationResult.recordSnapshots
    );
    if (storedSnapshotsResult.isErr()) {
      return err(storedSnapshotsResult.error);
    }

    return ok(storedSnapshotsResult.value);
  }

  private async executeDuplicateStreamChunks(
    context: IExecutionContext,
    plan: PreparedDuplicatePlan,
    queue: AsyncIterableQueue<DuplicateRecordsStreamEvent>,
    operation: {
      operationId: string;
      totalChunkCount: number;
    }
  ): Promise<Result<DuplicateRecordsStreamExecutionResult, DomainError>> {
    const duplicatedRecordIds: string[] = [];
    let duplicatedCount = 0;
    let anchorRecordId = plan.anchorRecordId;
    const operationPluginExecutionResult = await this.prepareDuplicatePluginExecution(
      context,
      plan.table,
      {
        batchIndex: -1,
        sourceRecords: [],
      },
      plan.batchSize,
      undefined,
      {
        mode: 'stream',
        scope: 'operation',
        operationId: operation.operationId,
        totalRecordCount: plan.totalCount,
        totalChunkCount: operation.totalChunkCount,
      },
      undefined,
      plan.totalCount
    );
    if (operationPluginExecutionResult.isErr()) {
      queue.push(
        this.createErrorEvent(operationPluginExecutionResult.error, {
          phase: 'guarding',
          batchIndex: -1,
          totalCount: plan.totalCount,
          duplicatedCount,
          recordIds: [],
        })
      );
      return ok({ duplicatedCount, duplicatedRecordIds });
    }

    let previousPluginExecution = operationPluginExecutionResult.value;

    for (const chunkPlan of plan.chunkPlans) {
      if (queue.isClosed()) {
        break;
      }

      try {
        const chunkResult = await this.runInSpan(
          context,
          'teable.DuplicateRecordsApplicationService.loadDuplicateChunk',
          {
            'teable.batch_index': chunkPlan.batchIndex,
            'teable.chunk_row_count': chunkPlan.sourceRecords.length,
            'teable.total_record_count': plan.totalCount,
            'teable.table_id': plan.table.id().toString(),
          },
          () => this.loadDuplicateChunk(chunkPlan)
        );
        if (chunkResult.isErr()) {
          queue.push(
            this.createErrorEvent(chunkResult.error, {
              phase: 'preparing',
              batchIndex: chunkPlan.batchIndex,
              totalCount: plan.totalCount,
              duplicatedCount,
              recordIds: [],
            })
          );
          continue;
        }

        const chunk = chunkResult.value;
        if (!chunk.sourceRecords.length) {
          continue;
        }

        const orderResult = this.createChunkOrder(plan.viewId, anchorRecordId);
        if (orderResult.isErr()) {
          queue.push(
            this.createErrorEvent(orderResult.error, {
              phase: 'duplicating',
              batchIndex: chunk.batchIndex,
              totalCount: plan.totalCount,
              duplicatedCount,
              recordIds: chunk.sourceRecords.map((record) => record.sourceRecordIdString),
            })
          );
          continue;
        }

        const pluginExecutionResult = await this.prepareDuplicatePluginExecution(
          context,
          plan.table,
          chunk,
          plan.batchSize,
          orderResult.value,
          {
            mode: 'stream',
            scope: 'chunk',
            operationId: operation.operationId,
            totalRecordCount: plan.totalCount,
            totalChunkCount: operation.totalChunkCount,
            chunkIndex: chunk.batchIndex,
          },
          previousPluginExecution
        );
        if (pluginExecutionResult.isErr()) {
          queue.push(
            this.createErrorEvent(pluginExecutionResult.error, {
              phase: 'guarding',
              batchIndex: chunk.batchIndex,
              totalCount: plan.totalCount,
              duplicatedCount,
              recordIds: chunk.sourceRecords.map((record) => record.sourceRecordIdString),
            })
          );
          continue;
        }

        const pluginExecution = pluginExecutionResult.value;
        previousPluginExecution = pluginExecution;
        const duplicateResult = await this.runInSpan(
          context,
          'teable.DuplicateRecordsApplicationService.duplicateChunk',
          {
            'teable.batch_index': chunk.batchIndex,
            'teable.chunk_record_count': chunk.sourceRecords.length,
            'teable.total_record_count': plan.totalCount,
            'teable.table_id': plan.table.id().toString(),
          },
          () =>
            this.duplicateChunkInSingleTransaction(
              context,
              plan.table,
              chunk,
              orderResult.value,
              pluginExecution,
              {
                operationId: operation.operationId,
                totalRecordCount: plan.totalCount,
                totalChunkCount: operation.totalChunkCount,
                chunkIndex: chunk.batchIndex,
              }
            )
        );
        if (duplicateResult.isErr()) {
          queue.push(
            this.createErrorEvent(duplicateResult.error, {
              phase: 'duplicating',
              batchIndex: chunk.batchIndex,
              totalCount: plan.totalCount,
              duplicatedCount,
              recordIds: chunk.sourceRecords.map((record) => record.sourceRecordIdString),
            })
          );
          continue;
        }

        const persisted = duplicateResult.value;
        duplicatedRecordIds.push(...persisted.duplicatedRecordIds);
        duplicatedCount += persisted.duplicatedRecordIds.length;

        const lastDuplicatedRecordId = persisted.duplicatedRecordIds.at(-1);
        if (lastDuplicatedRecordId) {
          const anchorRecordIdResult = RecordId.create(lastDuplicatedRecordId);
          if (anchorRecordIdResult.isOk()) {
            anchorRecordId = anchorRecordIdResult.value;
          }
        }

        queue.push(
          this.createProgressEvent(
            'duplicating',
            plan.totalCount,
            duplicatedCount,
            persisted.duplicatedRecordIds.length,
            chunk.batchIndex
          )
        );

        const publishResult = await this.runInSpan(
          context,
          'teable.DuplicateRecordsApplicationService.publishDuplicateChunkEvents',
          {
            'teable.batch_index': chunk.batchIndex,
            'teable.chunk_record_count': persisted.duplicatedRecordIds.length,
            'teable.total_record_count': plan.totalCount,
            'teable.table_id': plan.table.id().toString(),
          },
          () => this.eventBus.publishMany(context, persisted.events)
        );
        if (publishResult.isErr()) {
          queue.push(
            this.createErrorEvent(publishResult.error, {
              phase: 'publishing',
              batchIndex: chunk.batchIndex,
              totalCount: plan.totalCount,
              duplicatedCount,
              recordIds: [...persisted.duplicatedRecordIds],
            })
          );
        }

        const undoRedoResult = await this.runInSpan(
          context,
          'teable.DuplicateRecordsApplicationService.recordDuplicateChunkUndoRedo',
          {
            'teable.batch_index': chunk.batchIndex,
            'teable.chunk_record_count': persisted.duplicatedRecordIds.length,
            'teable.total_record_count': plan.totalCount,
            'teable.table_id': plan.table.id().toString(),
          },
          () =>
            this.recordDuplicateUndoRedoEntry(
              context,
              plan.table,
              persisted.duplicatedRecordIds,
              persisted.storedSnapshots,
              operation.operationId
            )
        );
        if (undoRedoResult.isErr()) {
          queue.push(
            this.createErrorEvent(undoRedoResult.error, {
              phase: 'finalizing',
              batchIndex: chunk.batchIndex,
              totalCount: plan.totalCount,
              duplicatedCount,
              recordIds: [...persisted.duplicatedRecordIds],
            })
          );
        }

        if (pluginExecution) {
          await pluginExecution.afterCommit();
        }
      } finally {
        await this.runInSpan(
          context,
          'teable.DuplicateRecordsApplicationService.yieldAfterDuplicateChunk',
          {
            'teable.batch_index': chunkPlan.batchIndex,
            'teable.total_record_count': plan.totalCount,
            'teable.table_id': plan.table.id().toString(),
          },
          () => yieldToEventLoop()
        );
      }
    }

    return ok({
      duplicatedCount,
      duplicatedRecordIds,
    });
  }

  private async loadDuplicateChunk(
    chunkPlan: PreparedDuplicateChunk
  ): Promise<Result<PreparedDuplicateChunk, DomainError>> {
    return ok(chunkPlan);
  }

  private createChunkOrder(
    viewId: ViewId,
    anchorRecordId: RecordId | undefined
  ): Result<RecordInsertOrder | undefined, DomainError> {
    if (!anchorRecordId) {
      return ok(undefined);
    }

    return RecordInsertOrder.create({
      viewId: viewId.toString(),
      anchorId: anchorRecordId.toString(),
      position: 'after',
    });
  }

  private async recordDuplicateUndoRedoEntry(
    context: IExecutionContext,
    table: Table,
    duplicatedRecordIds: ReadonlyArray<string>,
    storedSnapshots: ReadonlyArray<RecordStoredSnapshot>,
    groupId: string
  ): Promise<Result<void, DomainError>> {
    if (!storedSnapshots.length) {
      return ok(undefined);
    }

    return this.undoRedoStackService.appendRecordCreate(toUndoRedoStackAppendContext(context), {
      tableId: table.id(),
      createdRecordIds: duplicatedRecordIds,
      createdRecords: storedSnapshots,
      groupId,
    });
  }

  private createProgressEvent(
    phase: DuplicateRecordsStreamProgressEvent['phase'],
    totalCount: number,
    duplicatedCount: number,
    batchDuplicatedCount: number,
    batchIndex: number
  ): DuplicateRecordsStreamProgressEvent {
    return {
      id: 'progress',
      phase,
      batchIndex,
      totalCount,
      duplicatedCount,
      batchDuplicatedCount,
    };
  }

  private createDoneEvent(
    result: {
      duplicatedCount: number;
      duplicatedRecordIds: ReadonlyArray<string>;
    },
    totalCount: number = result.duplicatedCount
  ): DuplicateRecordsStreamDoneEvent {
    return {
      id: 'done',
      totalCount,
      duplicatedCount: result.duplicatedCount,
      data: {
        duplicatedCount: result.duplicatedCount,
        duplicatedRecordIds: [...result.duplicatedRecordIds],
      },
    };
  }

  private async runInSpan<T>(
    context: IExecutionContext,
    name: `teable.${string}`,
    attributes: SpanAttributes,
    callback: () => Promise<T>
  ): Promise<T> {
    const tracer = context.tracer;
    const span = tracer?.startSpan(name, {
      'teable.version': 'v2',
      'teable.component': 'service',
      'teable.operation': name.replace(/^teable\./, ''),
      ...attributes,
    });

    if (!tracer || !span) {
      return callback();
    }

    return tracer.withSpan(span, async () => {
      try {
        return await callback();
      } finally {
        span.end();
      }
    });
  }

  private createErrorEvent(
    error: DomainError,
    details: Omit<DuplicateRecordsStreamErrorEvent, 'id' | 'message' | 'code'>
  ): DuplicateRecordsStreamErrorEvent {
    return {
      id: 'error',
      ...details,
      code: error.code,
      message: error.message,
    };
  }
}
