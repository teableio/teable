import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { mergeOrderBy, resolveGroupByToOrderBy, resolveOrderBy } from '../commands/shared/orderBy';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import { PageLimit } from '../domain/shared/pagination/PageLimit';
import { PageOffset } from '../domain/shared/pagination/PageOffset';
import type { TableRecordAggregationGroup } from '../domain/table/records/TableRecordAggregation';
import { Table } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import {
  ITableRecordAggregationQueryRepository,
  type TableRecordAggregationValue,
  type TableRecordOrderBy,
} from '../ports/TableRecordQueryRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { AggregateTableRecordsQuery } from './AggregateTableRecordsQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';
import type { RecordFilter } from './RecordFilterDto';
import {
  buildSanitizedRecordConditionSpec,
  replaceCurrentUserTagInFilter,
  sanitizeRecordFilter,
} from './RecordFilterMapper';
import { RecordSearch, resolveVisibleRowSearch } from './RecordSearch';

const mergeFilters = (
  defaultFilter: RecordFilter | null | undefined,
  requestFilter: RecordFilter | null | undefined
): RecordFilter | undefined => {
  if (!defaultFilter) return requestFilter ?? undefined;
  if (!requestFilter) return defaultFilter;
  return { conjunction: 'and', items: [defaultFilter, requestFilter] };
};

export class AggregateTableRecordsResult {
  private constructor(
    readonly values: ReadonlyArray<TableRecordAggregationValue>,
    readonly groupBy: ReadonlyArray<TableRecordAggregationGroup>
  ) {}

  static create(
    values: ReadonlyArray<TableRecordAggregationValue>,
    groupBy: ReadonlyArray<TableRecordAggregationGroup> = []
  ): AggregateTableRecordsResult {
    return new AggregateTableRecordsResult(values, groupBy);
  }
}

@QueryHandler(AggregateTableRecordsQuery)
@injectable()
export class AggregateTableRecordsHandler
  implements IQueryHandler<AggregateTableRecordsQuery, AggregateTableRecordsResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: ITableRecordAggregationQueryRepository,
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger
  ) {}

  async handle(
    context: IExecutionContext,
    query: AggregateTableRecordsQuery
  ): Promise<Result<AggregateTableRecordsResult, DomainError>> {
    const logger = this.logger.scope('query', { name: AggregateTableRecordsHandler.name }).child({
      tableId: query.tableId.toString(),
      viewId: query.viewId.toString(),
    });

    return safeTry<AggregateTableRecordsResult, DomainError>(
      async function* (this: AggregateTableRecordsHandler) {
        const applyViewDefaults = !query.ignoreViewQuery;
        const specBuilder = Table.specs().byId(query.tableId);
        if (applyViewDefaults) {
          specBuilder.withViewId(query.viewId);
        }
        const tableSpec = yield* specBuilder.build();
        const table = yield* (await this.tableRepository.findOne(context, tableSpec)).mapErr(
          (error) =>
            isNotFoundError(error)
              ? domainError.notFound({
                  code: applyViewDefaults ? 'view.not_found' : 'table.not_found',
                  message: applyViewDefaults
                    ? `View not found: ${query.viewId.toString()}`
                    : `Table not found: ${query.tableId.toString()}`,
                })
              : error
        );
        const view = applyViewDefaults ? yield* table.getView(query.viewId) : undefined;
        const defaults = view ? yield* view.queryDefaults() : undefined;
        const defaultFilter = defaults
          ? replaceCurrentUserTagInFilter(table, defaults.filter(), context.actorId.toString())
          : undefined;
        const requestFilter = replaceCurrentUserTagInFilter(
          table,
          query.filter,
          context.actorId.toString()
        );
        const sanitizedDefaultFilter = yield* sanitizeRecordFilter(table, defaultFilter);
        const sanitizedRequestFilter = yield* sanitizeRecordFilter(table, requestFilter);
        let effectiveFilter = mergeFilters(sanitizedDefaultFilter, sanitizedRequestFilter);
        let conditionSpec = yield* buildSanitizedRecordConditionSpec(table, effectiveFilter);
        const includeHiddenFields = query.includeHiddenFields || query.ignoreViewQuery;
        const searchVisibleFieldIds = includeHiddenFields
          ? table.fieldIds()
          : yield* table.getOrderedVisibleFieldIds(query.viewId.toString());
        const visibleRowSearch = resolveVisibleRowSearch(
          RecordSearch.fromOptionalTuple(query.search),
          searchVisibleFieldIds
        );
        const aggregationViewId = applyViewDefaults ? query.viewId.toString() : undefined;
        if (query.collapsedGroupIds?.length && query.groupBy?.length) {
          const groupAggregation = yield* table.createRecordAggregation({
            viewId: aggregationViewId,
            fields: [
              {
                fieldId: query.groupBy[0]!.fieldId,
                statisticFunc: 'count',
              },
            ],
            groupBy: query.groupBy,
            includeHiddenFields,
          });
          const groupedValues = yield* await this.tableRecordQueryRepository.aggregate(
            context,
            table,
            groupAggregation,
            conditionSpec,
            {
              maxGroupPoints: query.maxGroupPoints,
              search: visibleRowSearch,
            }
          );
          const groupedRows = groupedValues
            .filter((value) => value.groupValues?.length === query.groupBy!.length)
            .map((value) => ({ groupValues: value.groupValues! }));
          const collapsedFilter = yield* table.createCollapsedGroupExclusionFilter(
            query.groupBy,
            groupedRows,
            new Set(query.collapsedGroupIds)
          );
          effectiveFilter = mergeFilters(effectiveFilter, collapsedFilter);
          conditionSpec = yield* buildSanitizedRecordConditionSpec(table, effectiveFilter);
        }
        const aggregation = yield* table.createRecordAggregation({
          viewId: aggregationViewId,
          fields: applyViewDefaults ? query.fields : query.fields ?? [],
          groupBy: query.take != null ? undefined : query.groupBy,
          includeHiddenFields,
        });

        let pagination: OffsetPagination | undefined;
        let orderBy: ReadonlyArray<TableRecordOrderBy> | undefined;
        if (query.take != null) {
          const limit = yield* PageLimit.create(query.take);
          const offset =
            query.skip != null ? yield* PageOffset.create(query.skip) : PageOffset.zero();
          pagination = OffsetPagination.create(limit, offset);
          const requestSort = query.orderBy ?? [];
          const viewSort = !defaults
            ? []
            : defaults.manualSort() && requestSort.length === 0
              ? []
              : defaults.sort() ?? [];
          const seen = new Set(requestSort.map((item) => item.fieldId));
          const combined = [...requestSort, ...viewSort.filter((item) => !seen.has(item.fieldId))];
          orderBy = mergeOrderBy(
            yield* resolveGroupByToOrderBy(query.groupBy),
            yield* resolveOrderBy(combined),
            applyViewDefaults ? query.viewId.toString() : undefined
          );
        }

        const values = yield* await this.tableRecordQueryRepository.aggregate(
          context,
          table,
          aggregation,
          conditionSpec,
          {
            maxGroupPoints: query.maxGroupPoints,
            search: visibleRowSearch,
            ...(pagination ? { pagination } : {}),
            ...(orderBy ? { orderBy } : {}),
          }
        );
        logger.debug('AggregateTableRecordsHandler.success', {
          fieldCount: aggregation.fields.length,
          groupDepth: aggregation.groupBy.length,
          valueCount: values.length,
        });
        return ok(AggregateTableRecordsResult.create(values, aggregation.groupBy));
      }.bind(this)
    ).orElse((error) => {
      logger.error('AggregateTableRecordsHandler.failed', { error: error.toString() });
      return err(error);
    });
  }
}
