import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { mergeOrderBy, resolveGroupByToOrderBy, resolveOrderBy } from '../commands/shared/orderBy';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import { PageLimit } from '../domain/shared/pagination/PageLimit';
import { PageOffset } from '../domain/shared/pagination/PageOffset';
import { composeAndSpecsOrUndefined } from '../domain/shared/specification/composeAndSpecs';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
import { TableRecordAggregation } from '../domain/table/records/TableRecordAggregation';
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
import {
  buildRecordConditionSpec,
  replaceCurrentUserTagInFilter,
  sanitizeRecordFilter,
} from './RecordFilterMapper';
import { RecordSearch, resolveVisibleRowSearch } from './RecordSearch';
import {
  buildLinkCandidatePlan,
  buildTableRecordConditionPlan,
} from './tableRecordQueryConditionPlan';
import {
  filterFieldIdsByQueryAccess,
  getEnabledFieldIdSet,
  mergeFilterWithViewDefaults,
  sanitizeFilterByEnabledFieldIds,
} from './tableRecordQueryPlan';

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
      viewId: query.viewId?.toString(),
    });

    return safeTry<AggregateTableRecordsResult, DomainError>(
      async function* (this: AggregateTableRecordsHandler) {
        const applyViewDefaults = !query.ignoreViewQuery && query.viewId != null;
        let table = query.table;
        if (!table || !table.id().equals(query.tableId)) {
          const specBuilder = Table.specs().byId(query.tableId);
          if (applyViewDefaults) {
            specBuilder.withViewId(query.viewId!);
          }
          const tableSpec = yield* specBuilder.build();
          table = yield* (await this.tableRepository.findOne(context, tableSpec)).mapErr((error) =>
            isNotFoundError(error)
              ? domainError.notFound({
                  code: applyViewDefaults ? 'view.not_found' : 'table.not_found',
                  message: applyViewDefaults
                    ? `View not found: ${query.viewId!.toString()}`
                    : `Table not found: ${query.tableId.toString()}`,
                })
              : error
          );
        }
        const conditionPlanDeps = {
          tableRepository: this.tableRepository,
          tableRecordQueryRepository: this.tableRecordQueryRepository,
          logger: this.logger,
        };
        const linkCandidatePlan = query.filterLinkCellCandidate
          ? yield* await buildLinkCandidatePlan(
              conditionPlanDeps,
              context,
              table,
              query.filterLinkCellCandidate
            )
          : undefined;
        let view = applyViewDefaults ? yield* table.getView(query.viewId!) : undefined;
        if (!view && linkCandidatePlan?.filterByViewId && !query.ignoreViewQuery) {
          const candidateView = table.getViewById(linkCandidatePlan.filterByViewId);
          if (candidateView.isOk()) view = candidateView.value;
        }
        const enabledFieldIds = getEnabledFieldIdSet(query);
        const maskedFieldIds = query.queryScope?.fieldMasks?.length
          ? new Set(query.queryScope.fieldMasks.map((mask) => mask.fieldId))
          : undefined;
        const hasQueryAccess = (fieldId: string) =>
          enabledFieldIds == null || enabledFieldIds.has(fieldId) || maskedFieldIds?.has(fieldId);
        const defaults = view ? yield* view.queryDefaults() : undefined;
        // Grid clients echo view.group as groupBy (and group points count the
        // first group field). Unavailable view-owned group fields degrade like
        // record lists instead of rejecting the whole statistics request.
        const viewOwnedGroupFieldIds = new Set(
          defaults?.group()?.map((item) => item.fieldId) ?? []
        );
        const skippedGroupFieldIds = new Set(
          (query.groupBy ?? [])
            .filter(
              (item) => viewOwnedGroupFieldIds.has(item.fieldId) && !hasQueryAccess(item.fieldId)
            )
            .map((item) => item.fieldId)
        );
        const remainingGroupBy = query.groupBy?.filter(
          (item) => !skippedGroupFieldIds.has(item.fieldId)
        );
        const groupBy = remainingGroupBy?.length ? remainingGroupBy : undefined;
        const fields = query.fields?.filter((item) => !skippedGroupFieldIds.has(item.fieldId));
        for (const [kind, inputs] of [
          ['aggregation', fields],
          ['group', groupBy],
          ['sort', query.orderBy],
        ] as const) {
          if (inputs?.some((input) => !hasQueryAccess(input.fieldId))) {
            return err(
              domainError.validation({
                code: `record.${kind}.unreadable_field`,
                message: `${kind} references a field that is not readable`,
              })
            );
          }
        }
        const defaultFilter = defaults
          ? replaceCurrentUserTagInFilter(table, defaults.filter(), context.actorId.toString())
          : undefined;
        const requestFilter = replaceCurrentUserTagInFilter(
          table,
          query.filter,
          context.actorId.toString()
        );
        const sanitizedDefaultFilter = yield* sanitizeRecordFilter(table, defaultFilter);
        const permissionDefaultFilter = yield* sanitizeFilterByEnabledFieldIds(
          sanitizedDefaultFilter ?? undefined,
          enabledFieldIds,
          maskedFieldIds,
          'strip'
        );
        const permissionRequestFilter = yield* sanitizeFilterByEnabledFieldIds(
          requestFilter ?? undefined,
          enabledFieldIds,
          maskedFieldIds,
          'reject'
        );
        const sanitizedRequestFilter = yield* sanitizeRecordFilter(table, permissionRequestFilter);
        const effectiveFilter = mergeFilterWithViewDefaults(
          permissionDefaultFilter,
          sanitizedRequestFilter ?? undefined
        );
        const builtQueryPlan = yield* await buildTableRecordConditionPlan(
          conditionPlanDeps,
          context,
          table,
          {
            filterLinkCellSelected: query.filterLinkCellSelected,
            filterLinkCellCandidate: query.filterLinkCellCandidate,
            selectedRecordIds: query.selectedRecordIds,
            fieldMasks: query.queryScope?.fieldMasks,
          },
          effectiveFilter,
          linkCandidatePlan
        );
        const rowScopeSpec = query.queryScope?.skipRecordSpec
          ? undefined
          : query.queryScope?.recordSpec;
        let conditionSpec = composeAndSpecsOrUndefined(
          [builtQueryPlan.spec, rowScopeSpec].filter(
            (spec): spec is ISpecification<TableRecord, ITableRecordConditionSpecVisitor> =>
              spec != null
          )
        );
        const includeHiddenFields = query.includeHiddenFields || query.ignoreViewQuery;
        const aggregationViewId = applyViewDefaults ? query.viewId?.toString() : undefined;
        const searchVisibleFieldIds = filterFieldIdsByQueryAccess(
          includeHiddenFields || !aggregationViewId
            ? table.fieldIds()
            : yield* table.getOrderedVisibleFieldIds(aggregationViewId),
          enabledFieldIds,
          maskedFieldIds
        );
        const visibleRowSearch = resolveVisibleRowSearch(
          RecordSearch.fromOptionalTuple(query.search),
          searchVisibleFieldIds
        );
        if (query.collapsedGroupIds?.length && groupBy?.length) {
          const groupAggregation = yield* table.createRecordAggregation({
            viewId: aggregationViewId,
            fields: [
              {
                fieldId: groupBy[0]!.fieldId,
                statisticFunc: 'count',
              },
            ],
            groupBy,
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
              searchAccessPath: query.recordSearchAccessPath,
              fieldMasks: query.queryScope?.fieldMasks,
            }
          );
          const groupedRows = groupedValues
            .filter((value) => value.groupValues?.length === groupBy.length)
            .map((value) => ({ groupValues: value.groupValues! }));
          const collapsedFilter = yield* table.createCollapsedGroupExclusionFilter(
            groupBy,
            groupedRows,
            new Set(query.collapsedGroupIds)
          );
          const collapsedSpec = collapsedFilter
            ? yield* buildRecordConditionSpec(table, collapsedFilter, query.queryScope?.fieldMasks)
            : undefined;
          conditionSpec = composeAndSpecsOrUndefined(
            [conditionSpec, collapsedSpec].filter(
              (spec): spec is ISpecification<TableRecord, ITableRecordConditionSpecVisitor> =>
                spec != null
            )
          );
        }
        let aggregation = yield* table.createRecordAggregation({
          viewId: aggregationViewId,
          fields: applyViewDefaults ? fields : fields ?? [],
          groupBy: query.take != null ? undefined : groupBy,
          includeHiddenFields,
        });
        if (!fields && enabledFieldIds != null) {
          aggregation = TableRecordAggregation.create(
            aggregation.fields.filter((field) => hasQueryAccess(field.fieldId.toString())),
            aggregation.groupBy
          );
        }

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
              : (defaults.sort() ?? []).filter((sort) => hasQueryAccess(sort.fieldId));
          const seen = new Set(requestSort.map((item) => item.fieldId));
          const combined = [...requestSort, ...viewSort.filter((item) => !seen.has(item.fieldId))];
          orderBy = mergeOrderBy(
            yield* resolveGroupByToOrderBy(groupBy),
            yield* resolveOrderBy(combined),
            aggregationViewId
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
            searchAccessPath: query.recordSearchAccessPath,
            fieldMasks: query.queryScope?.fieldMasks,
            recordIdsOrder: builtQueryPlan.recordIdsOrder,
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
