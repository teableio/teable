import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { RecordGroupByValue } from '../../commands/DeleteByRangeCommand';
import { normalizeRanges, type RangeType } from '../../commands/RangeUtils';
import { buildDeletedRecordSnapshot } from '../../commands/shared/buildDeletedRecordSnapshot';
import {
  mergeOrderByWithViewRowTieBreaker,
  resolveGroupByToOrderBy,
  resolveOrderBy,
} from '../../commands/shared/orderBy';
import { resolveSelectionStreamBatchSize } from '../../commands/shared/streamBatchSize';
import { domainError, isNotFoundError, type DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { generateUuid } from '../../domain/shared/IdGenerator';
import { OffsetPagination } from '../../domain/shared/pagination/OffsetPagination';
import { PageLimit } from '../../domain/shared/pagination/PageLimit';
import { PageOffset } from '../../domain/shared/pagination/PageOffset';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import {
  RecordsDeleted,
  type IDeletedRecordSnapshot,
  type IRecordsDeletedOrchestration,
} from '../../domain/table/events/RecordsDeleted';
import type { FieldId } from '../../domain/table/fields/FieldId';
import { RecordId } from '../../domain/table/records/RecordId';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import { RecordByIdsSpec } from '../../domain/table/records/specs/RecordByIdsSpec';
import { TableRecord } from '../../domain/table/records/TableRecord';
import type { Table } from '../../domain/table/Table';
import type { TableId } from '../../domain/table/TableId';
import type { ViewId } from '../../domain/table/views/ViewId';
import * as EventBusPort from '../../ports/EventBus';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { AsyncIterableQueue } from '../../ports/memory/AsyncIterableQueue';
import { RecordWriteOperationKind } from '../../ports/RecordWritePlugin';
import type { TableRecordOrderBy } from '../../ports/TableRecordQueryRepository';
import { ITableRecordQueryRepository } from '../../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import { type DeleteManyResult, ITableRecordRepository } from '../../ports/TableRecordRepository';
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
import type { RecordWritePluginExecution } from './RecordWritePluginRunner';
import { RecordWritePluginRunner } from './RecordWritePluginRunner';
import { TableQueryService } from './TableQueryService';
import { toUndoRedoStackAppendContext, UndoRedoStackService } from './UndoRedoStackService';

const DEFAULT_DELETE_QUERY_PAGE_SIZE = 500;
const MAX_DELETE_STREAM_BUFFERED_EVENTS = 64;

type DeleteByRangeCommandLike = {
  readonly tableId: TableId;
  readonly viewId: ViewId;
  readonly rawRanges: ReadonlyArray<readonly [number, number]>;
  readonly rangeType: RangeType;
  readonly filter: RecordFilter | undefined;
  readonly sort: ReadonlyArray<RecordSortValue> | undefined;
  readonly search: RecordSearch | undefined;
  readonly groupBy: ReadonlyArray<RecordGroupByValue> | undefined;
  readonly ignoreViewQuery: boolean;
};

type DeleteByRangeStreamCommandLike = DeleteByRangeCommandLike & {
  readonly batchSize?: number;
};

type PreparedDeletePlan = {
  readonly table: Table;
  readonly recordIds: ReadonlyArray<RecordId>;
  readonly deletedRecordIds: ReadonlyArray<string>;
  readonly recordSnapshots: ReadonlyArray<IDeletedRecordSnapshot>;
};

type PreparedDeleteStreamPlan = {
  readonly table: Table;
  readonly filterSpec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>;
  readonly orderBy?: ReadonlyArray<TableRecordOrderBy>;
  readonly search?: RecordQuerySearch;
  readonly totalCount: number;
  readonly batchSize: number;
  readonly chunkPlans: ReadonlyArray<DeleteStreamChunkPlan>;
};

type DeleteStreamChunkPlan = {
  readonly batchIndex: number;
  readonly rangeKey: string;
  readonly startRow: number;
  readonly rowCount: number;
};

type PreparedDeleteChunk = {
  readonly batchIndex: number;
  readonly recordIds: ReadonlyArray<RecordId>;
  readonly deletedRecordIds: ReadonlyArray<string>;
  readonly recordSnapshots: ReadonlyArray<IDeletedRecordSnapshot>;
};

type DeleteByRangeStreamExecutionResult = {
  readonly deletedCount: number;
  readonly deletedRecordIds: ReadonlyArray<string>;
};
type DeletePluginOrchestration = {
  readonly mode: 'direct' | 'stream';
  readonly scope: 'operation' | 'chunk';
  readonly operationId: string;
  readonly totalRecordCount: number;
  readonly totalChunkCount: number;
  readonly chunkIndex?: number;
};

export interface DeleteByRangeResult {
  deletedCount: number;
  deletedRecordIds: ReadonlyArray<string>;
  events: ReadonlyArray<IDomainEvent>;
}

export interface DeleteByRangeStreamProgressEvent {
  id: 'progress';
  phase: 'preparing' | 'deleting';
  batchIndex: number;
  totalCount: number;
  deletedCount: number;
  batchDeletedCount: number;
}

export interface DeleteByRangeStreamDoneEvent {
  id: 'done';
  totalCount: number;
  deletedCount: number;
  data: {
    deletedCount: number;
    deletedRecordIds: string[];
  };
}

export interface DeleteByRangeStreamErrorEvent {
  id: 'error';
  phase: 'preparing' | 'guarding' | 'deleting' | 'publishing' | 'finalizing';
  batchIndex: number;
  totalCount: number;
  deletedCount: number;
  recordIds: string[];
  message: string;
  code?: string;
}

export type DeleteByRangeStreamEvent =
  | DeleteByRangeStreamProgressEvent
  | DeleteByRangeStreamDoneEvent
  | DeleteByRangeStreamErrorEvent;

@injectable()
export class DeleteByRangeApplicationService {
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.recordWritePluginRunner)
    private readonly recordWritePluginRunner: RecordWritePluginRunner,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: ITableRecordRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: ITableRecordQueryRepository,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoStackService: UndoRedoStackService,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  async delete(
    context: IExecutionContext,
    command: DeleteByRangeCommandLike
  ): Promise<Result<DeleteByRangeResult, DomainError>> {
    const planResult = await this.prepareDeletePlan(
      context,
      command,
      DEFAULT_DELETE_QUERY_PAGE_SIZE
    );
    if (planResult.isErr()) {
      return err(planResult.error);
    }

    const plan = planResult.value;
    if (!plan.recordIds.length) {
      return ok({
        deletedCount: 0,
        deletedRecordIds: [],
        events: [],
      });
    }

    const operationId = context.requestId ?? generateUuid();
    const pluginExecutionResult = await this.prepareDeletePluginExecution(
      context,
      plan.table,
      plan.recordIds,
      plan.recordSnapshots,
      this.createDeletePluginOrchestration({
        mode: 'direct',
        scope: 'operation',
        operationId,
        totalRecordCount: plan.recordIds.length,
        totalChunkCount: 1,
      })
    );
    if (pluginExecutionResult.isErr()) {
      return err(pluginExecutionResult.error);
    }

    const persistResult = await this.deleteManyInSingleTransaction(
      context,
      plan,
      pluginExecutionResult.value
    );
    if (persistResult.isErr()) {
      return err(persistResult.error);
    }

    return this.finalizeDeletePlan(context, plan, persistResult.value, pluginExecutionResult.value);
  }

  createStream(
    context: IExecutionContext,
    command: DeleteByRangeStreamCommandLike
  ): AsyncIterable<DeleteByRangeStreamEvent> {
    const queue = new AsyncIterableQueue<DeleteByRangeStreamEvent>({
      maxBufferedItems: MAX_DELETE_STREAM_BUFFERED_EVENTS,
    });
    void this.runDeleteStream(context, command, queue);
    return queue;
  }

  private async runDeleteStream(
    context: IExecutionContext,
    command: DeleteByRangeStreamCommandLike,
    queue: AsyncIterableQueue<DeleteByRangeStreamEvent>
  ) {
    if (!queue.push(this.createProgressEvent('preparing', 0, 0, 0, -1))) {
      return;
    }

    try {
      const planResult = await this.prepareDeleteStreamPlan(context, command);
      if (planResult.isErr()) {
        queue.push(
          this.createErrorEvent(planResult.error, {
            phase: 'preparing',
            batchIndex: -1,
            totalCount: 0,
            deletedCount: 0,
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
              deletedCount: 0,
              deletedRecordIds: [],
              events: [],
            },
            0
          )
        );
        return;
      }

      const operationId = context.requestId ?? generateUuid();
      const executeResult = await this.executeDeleteStreamChunks(context, plan, queue, {
        operationId,
        totalChunkCount: plan.chunkPlans.length,
      });
      if (executeResult.isErr()) {
        queue.push(
          this.createErrorEvent(executeResult.error, {
            phase: 'deleting',
            batchIndex: -1,
            totalCount: plan.totalCount,
            deletedCount: 0,
            recordIds: [],
          })
        );
        return;
      }

      const executeSummary = executeResult.value;
      queue.push(
        this.createDoneEvent(
          {
            deletedCount: executeSummary.deletedCount,
            deletedRecordIds: executeSummary.deletedRecordIds,
            events: [],
          },
          plan.totalCount
        )
      );
    } catch (error) {
      queue.push(
        this.createErrorEvent(
          domainError.fromUnknown(error, {
            code: 'delete_by_range_stream.failed',
          }),
          {
            phase: 'deleting',
            batchIndex: -1,
            totalCount: 0,
            deletedCount: 0,
            recordIds: [],
          }
        )
      );
    } finally {
      queue.close();
    }
  }

  private async prepareDeletePlan(
    context: IExecutionContext,
    command: DeleteByRangeCommandLike,
    pageSize: number
  ): Promise<Result<PreparedDeletePlan, DomainError>> {
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

    const recordsResult = await this.collectRecordsToDelete(context, table, command, {
      filterSpec,
      orderBy,
      search: visibleRowSearch,
      totalCols: orderedFieldIdsResult.value.length,
      pageSize,
      // Undo/redo restore snapshots now come from repository capture instead of
      // the pre-read query, so we do not pay the extra row-order join here.
      includeOrders: false,
    });
    if (recordsResult.isErr()) {
      return err(recordsResult.error);
    }

    if (!recordsResult.value.length) {
      return ok({
        table,
        recordIds: [],
        deletedRecordIds: [],
        recordSnapshots: [],
      });
    }

    const recordIds: RecordId[] = [];
    const recordSnapshots: IDeletedRecordSnapshot[] = [];
    for (const record of recordsResult.value) {
      const recordIdResult = RecordId.create(record.id);
      if (recordIdResult.isErr()) {
        return err(recordIdResult.error);
      }

      recordIds.push(recordIdResult.value);
      recordSnapshots.push(buildDeletedRecordSnapshot(table, record));
    }

    return ok({
      table,
      recordIds,
      deletedRecordIds: recordSnapshots.map((snapshot) => snapshot.id),
      recordSnapshots,
    });
  }

  private async prepareDeleteStreamPlan(
    context: IExecutionContext,
    command: DeleteByRangeStreamCommandLike
  ): Promise<Result<PreparedDeleteStreamPlan, DomainError>> {
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

    const rowRanges = this.resolveDeleteStreamRowRanges(
      command,
      totalRowsResult.value,
      orderedFieldIdsResult.value.length
    );
    const totalCount = rowRanges.reduce(
      (sum, [startRow, endRow]) => sum + (endRow - startRow + 1),
      0
    );
    const batchSize = resolveSelectionStreamBatchSize(totalCount, command.batchSize);
    const chunkPlans = this.buildDeleteStreamChunkPlans(rowRanges, batchSize);

    return ok({
      table,
      filterSpec,
      orderBy,
      search: visibleRowSearch,
      totalCount,
      batchSize,
      chunkPlans,
    });
  }

  private async prepareDeletePluginExecution(
    context: IExecutionContext,
    table: Table,
    recordIds: ReadonlyArray<RecordId>,
    recordSnapshots: ReadonlyArray<IDeletedRecordSnapshot>,
    orchestration: DeletePluginOrchestration,
    options?: {
      previousExecution?: RecordWritePluginExecution;
      skipScopeValidation?: boolean;
      payloadRecordCount?: number;
    }
  ): Promise<Result<RecordWritePluginExecution | undefined, DomainError>> {
    const pluginExecutionResult = await this.recordWritePluginRunner.prepare(
      {
        kind: RecordWriteOperationKind.deleteMany,
        executionContext: context,
        table,
        orchestration,
        payload: {
          recordIds,
          recordCount: options?.payloadRecordCount ?? recordIds.length,
        },
        isTransactionBound: false,
      },
      { previousExecution: options?.previousExecution }
    );
    if (pluginExecutionResult.isErr()) {
      return err(pluginExecutionResult.error);
    }

    const pluginExecution = pluginExecutionResult.value;
    const guardResult = await pluginExecution.guard();
    if (guardResult.isErr()) {
      return err(guardResult.error);
    }

    const pluginRecordSpecResult = pluginExecution.getRecordSpec();
    if (pluginRecordSpecResult.isErr()) {
      return err(pluginRecordSpecResult.error);
    }

    if (!options?.skipScopeValidation) {
      const scopeResult = await this.ensureRecordsWithinPluginScope(
        table,
        recordSnapshots,
        pluginRecordSpecResult.value
      );
      if (scopeResult.isErr()) {
        return err(scopeResult.error);
      }
    }

    return ok(pluginExecution);
  }

  private async collectRecordsToDelete(
    context: IExecutionContext,
    table: Table,
    command: DeleteByRangeCommandLike,
    options: {
      filterSpec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>;
      orderBy?: ReadonlyArray<TableRecordOrderBy>;
      search?: RecordQuerySearch;
      totalCols: number;
      pageSize: number;
      projectionFieldIds?: ReadonlyArray<FieldId>;
      includeOrders?: boolean;
      includeTotal?: boolean;
    }
  ): Promise<Result<ReadonlyArray<TableRecordReadModel>, DomainError>> {
    const records: TableRecordReadModel[] = [];
    const pageSize = Math.max(1, options.pageSize);

    const appendRecords = async (start: number, end: number) => {
      for (let cursor = start; cursor <= end; cursor += pageSize) {
        const pageEnd = Math.min(end, cursor + pageSize - 1);
        const pageResult = await this.queryRecordsForRange(
          context,
          table,
          options.filterSpec,
          options.orderBy,
          options.search,
          cursor,
          pageEnd,
          {
            projectionFieldIds: options.projectionFieldIds,
            includeOrders: options.includeOrders,
            includeTotal: options.includeTotal,
          }
        );
        if (pageResult.isErr()) {
          return err(pageResult.error);
        }

        records.push(...pageResult.value);
      }

      return ok(undefined);
    };

    if (command.rangeType === 'rows') {
      for (const [startRow, endRow] of command.rawRanges) {
        const appendResult = await appendRecords(startRow, endRow);
        if (appendResult.isErr()) {
          return err(appendResult.error);
        }
      }
      return ok(records);
    }

    if (command.rangeType === 'columns') {
      const countLimitResult = PageLimit.create(1);
      if (countLimitResult.isErr()) {
        return ok(records);
      }

      const countPagination = OffsetPagination.create(countLimitResult.value, PageOffset.zero());
      const countResult = await this.tableRecordQueryRepository.find(
        context,
        table,
        options.filterSpec,
        {
          mode: 'stored',
          pagination: countPagination,
          orderBy: options.orderBy,
          search: options.search,
        }
      );
      if (countResult.isErr()) {
        return err(countResult.error);
      }

      const totalRows = countResult.value.total;
      if (totalRows <= 0) {
        return ok(records);
      }

      const appendResult = await appendRecords(0, totalRows - 1);
      if (appendResult.isErr()) {
        return err(appendResult.error);
      }
      return ok(records);
    }

    const normalizedRanges = normalizeRanges(
      command.rawRanges,
      command.rangeType,
      0,
      options.totalCols
    );
    const [[, startRow], [, endRow]] = normalizedRanges;
    const appendResult = await appendRecords(startRow, endRow);
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }

    return ok(records);
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
      projectionFieldIds?: ReadonlyArray<FieldId>;
      includeOrders?: boolean;
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
      includeOrders: options?.includeOrders,
      includeTotal: options?.includeTotal,
      projectionFieldIds: options?.projectionFieldIds,
    });
    if (queryResult.isErr()) {
      return err(queryResult.error);
    }

    return ok(queryResult.value.records);
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

  private resolveDeleteStreamRowRanges(
    command: DeleteByRangeCommandLike,
    totalRows: number,
    totalCols: number
  ): ReadonlyArray<readonly [number, number]> {
    if (totalRows <= 0) {
      return [];
    }

    if (command.rangeType === 'columns') {
      return [[0, totalRows - 1]];
    }

    if (command.rangeType === 'rows') {
      return command.rawRanges
        .map(([startRow, endRow]) => this.clampDeleteRowRange(startRow, endRow, totalRows))
        .filter((range): range is readonly [number, number] => Boolean(range));
    }

    const [[, startRow], [, endRow]] = normalizeRanges(
      command.rawRanges,
      command.rangeType,
      totalRows,
      totalCols
    );
    const normalizedRange = this.clampDeleteRowRange(startRow, endRow, totalRows);
    return normalizedRange ? [normalizedRange] : [];
  }

  private clampDeleteRowRange(
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

  private async ensureRecordsWithinPluginScope(
    table: Table,
    recordSnapshots: ReadonlyArray<IDeletedRecordSnapshot>,
    pluginRecordSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined
  ): Promise<Result<void, DomainError>> {
    if (!pluginRecordSpec || !recordSnapshots.length) {
      return ok(undefined);
    }

    let authorizedRecordCount = 0;
    for (const snapshot of recordSnapshots) {
      const recordResult = TableRecord.fromRawFieldValues({
        id: snapshot.id,
        tableId: table.id(),
        fields: snapshot.fields,
      });
      if (recordResult.isErr()) {
        return err(recordResult.error);
      }

      if (pluginRecordSpec.isSatisfiedBy(recordResult.value)) {
        authorizedRecordCount += 1;
      }
    }

    if (authorizedRecordCount === recordSnapshots.length) {
      return ok(undefined);
    }

    return err(
      domainError.forbidden({
        code: 'record_write_plugin.scope_forbidden',
        message: 'Record write target includes rows outside the allowed scope.',
        details: {
          operation: RecordWriteOperationKind.deleteMany,
          tableId: table.id().toString(),
          requestedRecordCount: recordSnapshots.length,
          authorizedRecordCount,
        },
      })
    );
  }

  private async deleteManyInSingleTransaction(
    context: IExecutionContext,
    plan: PreparedDeletePlan | (PreparedDeleteChunk & { table: Table }),
    pluginExecution?: RecordWritePluginExecution
  ): Promise<Result<DeleteManyResult, DomainError>> {
    return this.unitOfWork.withTransaction(context, async (transactionContext) => {
      if (pluginExecution) {
        const beforePersistResult = await pluginExecution.beforePersist(transactionContext);
        if (beforePersistResult.isErr()) {
          return err(beforePersistResult.error);
        }
      }

      const deleteResult = await this.tableRecordRepository.deleteMany(
        transactionContext,
        plan.table,
        RecordByIdsSpec.create(plan.recordIds)
      );
      if (deleteResult.isErr()) {
        if (isNotFoundError(deleteResult.error)) {
          return ok<DeleteManyResult>({});
        }
        return err(deleteResult.error);
      }

      return ok(deleteResult.value);
    });
  }

  private async executeDeleteStreamChunks(
    context: IExecutionContext,
    plan: PreparedDeleteStreamPlan,
    queue: AsyncIterableQueue<DeleteByRangeStreamEvent>,
    operation: {
      operationId: string;
      totalChunkCount: number;
    }
  ): Promise<Result<DeleteByRangeStreamExecutionResult, DomainError>> {
    const deletedRecordIds: string[] = [];
    let deletedCount = 0;
    let currentRangeKey: string | undefined;
    let failedRowCountInRange = 0;
    const operationPluginExecutionResult = await this.prepareDeletePluginExecution(
      context,
      plan.table,
      [],
      [],
      this.createDeletePluginOrchestration({
        mode: 'stream',
        scope: 'operation',
        operationId: operation.operationId,
        totalRecordCount: plan.totalCount,
        totalChunkCount: operation.totalChunkCount,
      }),
      { skipScopeValidation: true, payloadRecordCount: plan.totalCount }
    );
    if (operationPluginExecutionResult.isErr()) {
      queue.push(
        this.createErrorEvent(operationPluginExecutionResult.error, {
          phase: 'guarding',
          batchIndex: -1,
          totalCount: plan.totalCount,
          deletedCount,
          recordIds: [],
        })
      );
      return ok({ deletedCount, deletedRecordIds });
    }

    let previousPluginExecution = operationPluginExecutionResult.value;

    for (const plannedChunk of plan.chunkPlans) {
      if (queue.isClosed()) {
        break;
      }

      if (plannedChunk.rangeKey !== currentRangeKey) {
        currentRangeKey = plannedChunk.rangeKey;
        failedRowCountInRange = 0;
      }

      const chunkResult = await this.runInSpan(
        context,
        'teable.DeleteByRangeApplicationService.loadDeleteChunk',
        {
          'teable.batch_index': plannedChunk.batchIndex,
          'teable.chunk_row_count': plannedChunk.rowCount,
          'teable.total_record_count': plan.totalCount,
          'teable.table_id': plan.table.id().toString(),
        },
        () => this.loadDeleteChunk(context, plan, plannedChunk, failedRowCountInRange)
      );
      if (chunkResult.isErr()) {
        failedRowCountInRange += plannedChunk.rowCount;
        queue.push(
          this.createErrorEvent(chunkResult.error, {
            phase: 'preparing',
            batchIndex: plannedChunk.batchIndex,
            totalCount: plan.totalCount,
            deletedCount,
            recordIds: [],
          })
        );
        continue;
      }

      const chunk = chunkResult.value;
      if (!chunk.recordIds.length) {
        failedRowCountInRange += plannedChunk.rowCount;
        continue;
      }

      const pluginExecutionResult = await this.prepareDeletePluginExecution(
        context,
        plan.table,
        chunk.recordIds,
        chunk.recordSnapshots,
        this.createDeletePluginOrchestration({
          mode: 'stream',
          scope: 'chunk',
          operationId: operation.operationId,
          totalRecordCount: plan.totalCount,
          totalChunkCount: operation.totalChunkCount,
          chunkIndex: chunk.batchIndex,
        }),
        { previousExecution: previousPluginExecution }
      );
      if (pluginExecutionResult.isErr()) {
        failedRowCountInRange += chunk.recordIds.length;
        queue.push(
          this.createErrorEvent(pluginExecutionResult.error, {
            phase: 'guarding',
            batchIndex: chunk.batchIndex,
            totalCount: plan.totalCount,
            deletedCount,
            recordIds: [...chunk.deletedRecordIds],
          })
        );
        continue;
      }

      const pluginExecution = pluginExecutionResult.value;
      previousPluginExecution = pluginExecution;
      const deleteResult = await this.runInSpan(
        context,
        'teable.DeleteByRangeApplicationService.deleteChunk',
        {
          'teable.batch_index': chunk.batchIndex,
          'teable.chunk_record_count': chunk.recordIds.length,
          'teable.total_record_count': plan.totalCount,
          'teable.table_id': plan.table.id().toString(),
        },
        () =>
          this.deleteManyInSingleTransaction(
            context,
            { ...chunk, table: plan.table },
            pluginExecution
          )
      );
      if (deleteResult.isErr()) {
        failedRowCountInRange += chunk.recordIds.length;
        queue.push(
          this.createErrorEvent(deleteResult.error, {
            phase: 'deleting',
            batchIndex: chunk.batchIndex,
            totalCount: plan.totalCount,
            deletedCount,
            recordIds: [...chunk.deletedRecordIds],
          })
        );
        continue;
      }

      const persistedRecordSnapshotsResult = this.resolveDeletedSnapshots(
        plan.table,
        chunk.recordSnapshots,
        deleteResult.value
      );
      if (persistedRecordSnapshotsResult.isErr()) {
        failedRowCountInRange += chunk.recordIds.length;
        queue.push(
          this.createErrorEvent(persistedRecordSnapshotsResult.error, {
            phase: 'deleting',
            batchIndex: chunk.batchIndex,
            totalCount: plan.totalCount,
            deletedCount,
            recordIds: [...chunk.deletedRecordIds],
          })
        );
        continue;
      }
      const persistedRecordSnapshots = persistedRecordSnapshotsResult.value;
      const persistedDeletedRecordIds = persistedRecordSnapshots.map((snapshot) => snapshot.id);

      deletedRecordIds.push(...persistedDeletedRecordIds);
      deletedCount += persistedDeletedRecordIds.length;

      queue.push(
        this.createProgressEvent(
          'deleting',
          plan.totalCount,
          deletedCount,
          persistedDeletedRecordIds.length,
          chunk.batchIndex
        )
      );

      const publishResult = await this.runInSpan(
        context,
        'teable.DeleteByRangeApplicationService.publishDeleteChunkEvents',
        {
          'teable.batch_index': chunk.batchIndex,
          'teable.chunk_record_count': chunk.recordIds.length,
          'teable.total_record_count': plan.totalCount,
          'teable.table_id': plan.table.id().toString(),
        },
        () =>
          this.publishDeleteEvents(context, {
            table: plan.table,
            recordIds: persistedDeletedRecordIds.map((recordId) =>
              RecordId.create(recordId)._unsafeUnwrap()
            ),
            recordSnapshots: persistedRecordSnapshots,
            orchestration: {
              operationId: operation.operationId,
              groupId: operation.operationId,
              totalRecordCount: plan.totalCount,
              totalChunkCount: operation.totalChunkCount,
              chunkIndex: chunk.batchIndex,
              scope: 'chunk',
            },
          })
      );
      if (publishResult.isErr()) {
        queue.push(
          this.createErrorEvent(publishResult.error, {
            phase: 'publishing',
            batchIndex: chunk.batchIndex,
            totalCount: plan.totalCount,
            deletedCount,
            recordIds: [...persistedDeletedRecordIds],
          })
        );
      }

      const undoRedoResult = await this.runInSpan(
        context,
        'teable.DeleteByRangeApplicationService.recordDeleteChunkUndoRedo',
        {
          'teable.batch_index': chunk.batchIndex,
          'teable.chunk_record_count': chunk.deletedRecordIds.length,
          'teable.total_record_count': plan.totalCount,
          'teable.table_id': plan.table.id().toString(),
        },
        () =>
          this.recordDeleteUndoRedoEntry(
            context,
            plan.table,
            persistedRecordSnapshots,
            persistedDeletedRecordIds,
            operation.operationId
          )
      );
      if (undoRedoResult.isErr()) {
        queue.push(
          this.createErrorEvent(undoRedoResult.error, {
            phase: 'finalizing',
            batchIndex: chunk.batchIndex,
            totalCount: plan.totalCount,
            deletedCount,
            recordIds: [...persistedDeletedRecordIds],
          })
        );
      }

      if (pluginExecution) {
        await pluginExecution.afterCommit();
      }
    }

    return ok({
      deletedCount,
      deletedRecordIds,
    });
  }

  private buildDeleteStreamChunkPlans(
    rowRanges: ReadonlyArray<readonly [number, number]>,
    batchSize: number
  ): ReadonlyArray<DeleteStreamChunkPlan> {
    const chunkPlans: DeleteStreamChunkPlan[] = [];
    const normalizedBatchSize = Math.max(1, batchSize);
    const sortedRanges = [...rowRanges].sort((left, right) => {
      if (left[0] !== right[0]) {
        return right[0] - left[0];
      }
      return right[1] - left[1];
    });

    let batchIndex = 0;
    for (const [startRow, endRow] of sortedRanges) {
      const rangeKey = `${startRow}:${endRow}`;
      let remainingRowCount = endRow - startRow + 1;
      while (remainingRowCount > 0) {
        const chunkRowCount = Math.min(normalizedBatchSize, remainingRowCount);
        chunkPlans.push({
          batchIndex,
          rangeKey,
          startRow,
          rowCount: chunkRowCount,
        });
        batchIndex += 1;
        remainingRowCount -= chunkRowCount;
      }
    }

    return chunkPlans;
  }

  private async loadDeleteChunk(
    context: IExecutionContext,
    plan: PreparedDeleteStreamPlan,
    chunk: DeleteStreamChunkPlan,
    failedRowCountInRange: number
  ): Promise<Result<PreparedDeleteChunk, DomainError>> {
    const queryStartRow = chunk.startRow + failedRowCountInRange;
    const queryResult = await this.queryRecordsForRange(
      context,
      plan.table,
      plan.filterSpec,
      plan.orderBy,
      plan.search,
      queryStartRow,
      queryStartRow + chunk.rowCount - 1,
      {
        // Repository-backed delete capture supplies the persisted order snapshot.
        includeOrders: false,
        includeTotal: false,
      }
    );
    if (queryResult.isErr()) {
      return err(queryResult.error);
    }

    const recordIds: RecordId[] = [];
    const deletedRecordIds: string[] = [];
    const recordSnapshots: IDeletedRecordSnapshot[] = [];
    for (const record of queryResult.value) {
      const recordIdResult = RecordId.create(record.id);
      if (recordIdResult.isErr()) {
        return err(recordIdResult.error);
      }

      recordIds.push(recordIdResult.value);
      deletedRecordIds.push(record.id);
      recordSnapshots.push(buildDeletedRecordSnapshot(plan.table, record));
    }

    return ok({
      batchIndex: chunk.batchIndex,
      recordIds,
      deletedRecordIds,
      recordSnapshots,
    });
  }

  private async finalizeDeletePlan(
    context: IExecutionContext,
    plan: PreparedDeletePlan,
    deleteResult: DeleteManyResult,
    pluginExecution?: RecordWritePluginExecution
  ): Promise<Result<DeleteByRangeResult, DomainError>> {
    const recordSnapshotsResult = this.resolveDeletedSnapshots(
      plan.table,
      plan.recordSnapshots,
      deleteResult
    );
    if (recordSnapshotsResult.isErr()) {
      return err(recordSnapshotsResult.error);
    }
    const recordSnapshots = recordSnapshotsResult.value;
    const recordIds = recordSnapshots.map((snapshot) =>
      RecordId.create(snapshot.id)._unsafeUnwrap()
    );

    const publishResult = await this.publishDeleteEvents(context, {
      table: plan.table,
      recordIds,
      recordSnapshots,
      orchestration: {
        operationId: context.requestId,
        totalRecordCount: recordIds.length,
        totalChunkCount: 1,
        chunkIndex: 0,
        scope: 'operation',
      },
    });
    if (publishResult.isErr()) {
      return err(publishResult.error);
    }

    const undoRedoResult = await this.recordUndoRedoEntry(context, plan.table, recordSnapshots);
    if (undoRedoResult.isErr()) {
      return err(undoRedoResult.error);
    }

    if (pluginExecution) {
      await pluginExecution.afterCommit();
    }

    return ok({
      deletedCount: recordSnapshots.length,
      deletedRecordIds: recordSnapshots.map((snapshot) => snapshot.id),
      events: publishResult.value,
    });
  }

  private resolveDeletedSnapshots(
    table: Table,
    fallbackSnapshots: ReadonlyArray<IDeletedRecordSnapshot>,
    deleteResult: DeleteManyResult
  ): Result<ReadonlyArray<IDeletedRecordSnapshot>, DomainError> {
    const persistedDeletedRecords = deleteResult.deletedRecords;

    const storedSnapshotsResult = requireStoredRecordSnapshots(
      {
        operation: 'delete',
        tableId: table.id().toString(),
        ...(fallbackSnapshots.length > 0 ? { expectedCount: fallbackSnapshots.length } : {}),
      },
      persistedDeletedRecords
    );
    if (storedSnapshotsResult.isErr()) {
      return err(storedSnapshotsResult.error);
    }

    return ok(
      storedSnapshotsResult.value.map((snapshot) => buildDeletedRecordSnapshot(table, snapshot))
    );
  }

  private async publishDeleteEvents(
    context: IExecutionContext,
    input: {
      table: Table;
      recordIds: ReadonlyArray<RecordId>;
      recordSnapshots: ReadonlyArray<IDeletedRecordSnapshot>;
      orchestration?: IRecordsDeletedOrchestration;
    }
  ): Promise<Result<ReadonlyArray<IDomainEvent>, DomainError>> {
    const events: IDomainEvent[] = [
      RecordsDeleted.create({
        tableId: input.table.id(),
        baseId: input.table.baseId(),
        recordIds: input.recordIds,
        recordSnapshots: input.recordSnapshots,
        orchestration: input.orchestration,
      }),
    ];

    const publishResult = await this.eventBus.publishMany(context, events);
    if (publishResult.isErr()) {
      return err(publishResult.error);
    }

    return ok(events);
  }

  private async recordUndoRedoEntry(
    context: IExecutionContext,
    table: Table,
    recordSnapshots: ReadonlyArray<IDeletedRecordSnapshot>
  ): Promise<Result<void, DomainError>> {
    return this.recordDeleteUndoRedoEntry(
      context,
      table,
      recordSnapshots,
      recordSnapshots.map((snapshot) => snapshot.id)
    );
  }

  private async recordDeleteUndoRedoEntry(
    context: IExecutionContext,
    table: Table,
    recordSnapshots: ReadonlyArray<IDeletedRecordSnapshot>,
    deletedRecordIds: ReadonlyArray<string>,
    groupId?: string
  ): Promise<Result<void, DomainError>> {
    if (!recordSnapshots.length) {
      return ok(undefined);
    }

    return this.undoRedoStackService.appendRecordDelete(toUndoRedoStackAppendContext(context), {
      tableId: table.id(),
      deletedRecords: recordSnapshots.map((snapshot) => ({
        recordId: snapshot.id,
        fields: snapshot.fields,
        ...(snapshot.version !== undefined ? { version: snapshot.version } : {}),
        ...(snapshot.orders ? { orders: snapshot.orders } : {}),
        ...(snapshot.autoNumber !== undefined ? { autoNumber: snapshot.autoNumber } : {}),
        ...(snapshot.createdTime ? { createdTime: snapshot.createdTime } : {}),
        ...(snapshot.createdBy ? { createdBy: snapshot.createdBy } : {}),
        ...(snapshot.lastModifiedTime ? { lastModifiedTime: snapshot.lastModifiedTime } : {}),
        ...(snapshot.lastModifiedBy ? { lastModifiedBy: snapshot.lastModifiedBy } : {}),
      })),
      deletedRecordIds,
      groupId,
    });
  }

  private createProgressEvent(
    phase: DeleteByRangeStreamProgressEvent['phase'],
    totalCount: number,
    deletedCount: number,
    batchDeletedCount: number,
    batchIndex: number
  ): DeleteByRangeStreamProgressEvent {
    return {
      id: 'progress',
      phase,
      batchIndex,
      totalCount,
      deletedCount,
      batchDeletedCount,
    };
  }

  private createDeletePluginOrchestration(
    input: DeletePluginOrchestration
  ): DeletePluginOrchestration {
    return input;
  }

  private createDoneEvent(
    result: DeleteByRangeResult,
    totalCount: number = result.deletedCount
  ): DeleteByRangeStreamDoneEvent {
    return {
      id: 'done',
      totalCount,
      deletedCount: result.deletedCount,
      data: {
        deletedCount: result.deletedCount,
        deletedRecordIds: [...result.deletedRecordIds],
      },
    };
  }

  private createErrorEvent(
    error: DomainError,
    details: Omit<DeleteByRangeStreamErrorEvent, 'id' | 'message' | 'code'>
  ): DeleteByRangeStreamErrorEvent {
    return {
      id: 'error',
      ...details,
      code: error.code,
      message: error.message,
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
}
