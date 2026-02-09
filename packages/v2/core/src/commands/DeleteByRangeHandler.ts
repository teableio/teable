import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableQueryService } from '../application/services/TableQueryService';
import { UndoRedoService } from '../application/services/UndoRedoService';
import { isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import { PageLimit } from '../domain/shared/pagination/PageLimit';
import { PageOffset } from '../domain/shared/pagination/PageOffset';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { IDeletedRecordSnapshot } from '../domain/table/events/RecordsDeleted';
import { RecordsDeleted } from '../domain/table/events/RecordsDeleted';
import { RecordId } from '../domain/table/records/RecordId';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import { TableRecord } from '../domain/table/records/TableRecord';
import type { TableRecord as TableRecordEntity } from '../domain/table/records/TableRecord';
import type { Table } from '../domain/table/Table';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import type { RecordSearchValue } from '../queries/ListTableRecordsQuery';
import {
  isRecordFilterGroup,
  type RecordFilter,
  type RecordFilterCondition,
} from '../queries/RecordFilterDto';
import { buildRecordConditionSpec } from '../queries/RecordFilterMapper';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { DeleteByRangeCommand } from './DeleteByRangeCommand';
import { mergeOrderBy, resolveGroupByToOrderBy, resolveOrderBy } from './shared/orderBy';

export interface DeleteByRangeResult {
  /** Number of records deleted */
  deletedCount: number;
  /** IDs of deleted records */
  deletedRecordIds: ReadonlyArray<string>;
  /** Domain events emitted */
  events: ReadonlyArray<IDomainEvent>;
}

/**
 * Merge search filter with existing filter.
 * Search is converted to a "contains" filter condition.
 */
const mergeSearchFilter = (
  filter: RecordFilter | undefined,
  search: RecordSearchValue | undefined
): RecordFilter | undefined => {
  if (!search) return filter;
  const [term, fieldKey] = search;
  const searchCondition: RecordFilterCondition = {
    fieldId: fieldKey,
    operator: 'contains',
    value: term,
  };

  if (!filter) return searchCondition;
  if (isRecordFilterGroup(filter) && filter.conjunction === 'and') {
    return { ...filter, items: [...filter.items, searchCondition] };
  }
  return { conjunction: 'and', items: [filter, searchCondition] };
};

@CommandHandler(DeleteByRangeCommand)
@injectable()
export class DeleteByRangeHandler
  implements ICommandHandler<DeleteByRangeCommand, DeleteByRangeResult>
{
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoService: UndoRedoService,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  /**
   * Query records for a single range (rows or columns type).
   */
  private async queryRecordsForRange(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    filterSpec: ISpecification<TableRecordEntity, ITableRecordConditionSpecVisitor> | undefined,
    orderBy: ReadonlyArray<TableRecordQueryRepositoryPort.TableRecordOrderBy> | undefined,
    start: number,
    end: number
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
      includeOrders: true, // Include order values for undo/redo support
    });

    if (queryResult.isErr()) {
      return err(queryResult.error);
    }

    return ok(queryResult.value.records);
  }

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: DeleteByRangeCommand
  ): Promise<Result<DeleteByRangeResult, DomainError>> {
    const handler = this;

    return safeTry<DeleteByRangeResult, DomainError>(async function* () {
      // 1. Get table
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);

      // 2. Get ordered visible field IDs from view's columnMeta (needed for range normalization)
      const orderedFieldIds = yield* table.getOrderedVisibleFieldIds(command.viewId.toString());
      const totalCols = orderedFieldIds.length;

      const view = yield* table.getView(command.viewId);
      const viewDefaults = yield* view.queryDefaults();
      const mergedDefaults = viewDefaults.merge({
        filter: command.filter,
        sort: command.sort,
      });
      const effectiveFilter = mergedDefaults.filter() ?? undefined;
      const effectiveSort = mergedDefaults.sort();

      // 3. Build filter spec from effective filter merged with search (if provided)
      const mergedFilter = mergeSearchFilter(effectiveFilter, command.search);
      let filterSpec:
        | ISpecification<TableRecordEntity, ITableRecordConditionSpecVisitor>
        | undefined;
      if (mergedFilter) {
        filterSpec = yield* buildRecordConditionSpec(table, mergedFilter);
      }

      // 4. Resolve orderBy from groupBy and sort
      // GroupBy fields are prepended to the sort order
      // If no explicit orderBy, fall back to view row order column
      const groupByOrderBy = yield* resolveGroupByToOrderBy(command.groupBy);
      const sortOrderBy = yield* resolveOrderBy(effectiveSort);
      const orderBy = mergeOrderBy(groupByOrderBy, sortOrderBy, command.viewId.toString());

      // 5. Query records based on range type
      let recordsToDelete: ReadonlyArray<TableRecordReadModel> = [];

      if (command.rangeType === 'rows') {
        // For rows type, each range element is [startRow, endRow]
        // Multiple elements represent non-contiguous row selections
        for (const [startRow, endRow] of command.rawRanges) {
          const records = yield* await handler.queryRecordsForRange(
            context,
            table,
            filterSpec,
            orderBy,
            startRow,
            endRow
          );
          recordsToDelete = [...recordsToDelete, ...records];
        }
      } else if (command.rangeType === 'columns') {
        // For columns type, each range element is [startCol, endCol]
        // We need to get total row count first, then query all rows
        const limitResult = PageLimit.create(1);
        if (limitResult.isOk()) {
          const pagination = OffsetPagination.create(limitResult.value, PageOffset.zero());
          const countResult = yield* await handler.tableRecordQueryRepository.find(
            context,
            table,
            filterSpec,
            { mode: 'stored', pagination, orderBy }
          );
          const totalRows = countResult.total;

          // For columns, we delete all rows (columns type means entire columns selected)
          if (totalRows > 0) {
            const records = yield* await handler.queryRecordsForRange(
              context,
              table,
              filterSpec,
              orderBy,
              0,
              totalRows - 1
            );
            recordsToDelete = records;
          }
        }
      } else {
        // Default: cell range - ranges is [[startCol, startRow], [endCol, endRow]]
        const normalizedRanges = command.normalizeRanges(0, totalCols);
        const [[, startRow], [, endRow]] = normalizedRanges;

        const records = yield* await handler.queryRecordsForRange(
          context,
          table,
          filterSpec,
          orderBy,
          startRow,
          endRow
        );
        recordsToDelete = records;
      }

      if (recordsToDelete.length === 0) {
        return ok({ deletedCount: 0, deletedRecordIds: [], events: [] });
      }

      // 6. Capture snapshots before deletion (for undo/redo)
      const recordSnapshots: IDeletedRecordSnapshot[] = recordsToDelete.map((record) => ({
        id: record.id,
        fields: record.fields,
        autoNumber: record.autoNumber,
        createdTime: record.createdTime,
        createdBy: record.createdBy,
        lastModifiedTime: record.lastModifiedTime,
        lastModifiedBy: record.lastModifiedBy,
        orders: record.orders,
      }));

      // 7. Build delete spec using record IDs
      const specBuilder = TableRecord.specs('or');
      const recordIds: RecordId[] = [];
      for (const record of recordsToDelete) {
        const recordId = yield* RecordId.create(record.id);
        specBuilder.recordId(recordId);
        recordIds.push(recordId);
      }
      const deleteSpec = yield* specBuilder.build();

      // 8. Execute deletion within transaction
      yield* await handler.unitOfWork.withTransaction(context, async (transactionContext) => {
        const deleteResult = await handler.tableRecordRepository.deleteMany(
          transactionContext,
          table,
          deleteSpec
        );

        if (deleteResult.isErr()) {
          if (isNotFoundError(deleteResult.error)) return ok(undefined);
          return err(deleteResult.error);
        }

        return ok(undefined);
      });

      // 9. Publish RecordsDeleted event
      const events: IDomainEvent[] = [
        RecordsDeleted.create({
          tableId: table.id(),
          baseId: table.baseId(),
          recordIds,
          recordSnapshots,
        }),
      ];
      yield* await handler.eventBus.publishMany(context, events);

      const restoreRecords = recordSnapshots.map((snapshot) => ({
        recordId: snapshot.id,
        fields: snapshot.fields,
        orders: snapshot.orders,
        autoNumber: snapshot.autoNumber,
        createdTime: snapshot.createdTime,
        createdBy: snapshot.createdBy,
        lastModifiedTime: snapshot.lastModifiedTime,
        lastModifiedBy: snapshot.lastModifiedBy,
      }));

      if (restoreRecords.length > 0) {
        yield* await handler.undoRedoService.recordEntry(context, table.id(), {
          undoCommand: {
            type: 'RestoreRecords',
            version: 1,
            payload: {
              tableId: table.id().toString(),
              records: restoreRecords,
            },
          },
          redoCommand: {
            type: 'DeleteRecords',
            version: 1,
            payload: {
              tableId: table.id().toString(),
              recordIds: restoreRecords.map((record) => record.recordId),
            },
          },
        });
      }

      return ok({
        deletedCount: recordsToDelete.length,
        deletedRecordIds: recordsToDelete.map((r) => r.id),
        events,
      });
    });
  }
}
