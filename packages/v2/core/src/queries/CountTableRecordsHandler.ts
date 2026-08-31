import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { composeAndSpecsOrUndefined } from '../domain/shared/specification/composeAndSpecs';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
import { TableByIdSpec } from '../domain/table/specs/TableByIdSpec';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import { ITableRecordCountQueryRepository } from '../ports/TableRecordQueryRepository';
import type { ITableRecordCountOptions } from '../ports/TableRecordQueryRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { CountTableRecordsQuery } from './CountTableRecordsQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';
import { replaceCurrentUserTagInFilter, sanitizeRecordFilter } from './RecordFilterMapper';
import { RecordSearch, resolveVisibleRowSearch } from './RecordSearch';
import {
  buildLinkCandidatePlan,
  buildTableRecordConditionPlan,
} from './tableRecordQueryConditionPlan';
import {
  filterFieldIdsByQueryAccess,
  getEnabledFieldIdSet,
  mergeFilterWithViewDefaults,
  resolveFilterFieldKeys,
  resolveProjectionFieldIds,
  sanitizeFilterByEnabledFieldIds,
} from './tableRecordQueryPlan';

export class CountTableRecordsResult {
  private constructor(readonly count: number) {}

  static create(count: number): CountTableRecordsResult {
    return new CountTableRecordsResult(count);
  }
}

@QueryHandler(CountTableRecordsQuery)
@injectable()
export class CountTableRecordsHandler
  implements IQueryHandler<CountTableRecordsQuery, CountTableRecordsResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: ITableRecordCountQueryRepository,
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger
  ) {}

  async handle(
    context: IExecutionContext,
    query: CountTableRecordsQuery
  ): Promise<Result<CountTableRecordsResult, DomainError>> {
    const logger = this.logger.scope('query', { name: CountTableRecordsHandler.name }).child({
      tableId: query.tableId.toString(),
    });
    logger.debug('CountTableRecordsHandler.start', { actorId: context.actorId.toString() });

    return safeTry<CountTableRecordsResult, DomainError>(
      async function* (this: CountTableRecordsHandler) {
        const preloadedTable =
          query.table && query.table.id().equals(query.tableId) ? query.table : undefined;
        const table =
          preloadedTable ??
          (yield* (
            await this.tableRepository.findOne(context, TableByIdSpec.create(query.tableId))
          ).mapErr((error: DomainError) =>
            isNotFoundError(error)
              ? domainError.notFound({ code: 'table.not_found', message: 'Table not found' })
              : error
          ));

        const enabledFieldIds = getEnabledFieldIdSet(query);
        const maskedFieldIds = query.queryScope?.fieldMasks?.length
          ? new Set(query.queryScope.fieldMasks.map((mask) => mask.fieldId))
          : undefined;
        const resolvedFilter = query.filter
          ? yield* resolveFilterFieldKeys(table, query.filter, query.fieldKeyType)
          : undefined;
        const actorResolvedFilter = replaceCurrentUserTagInFilter(
          table,
          resolvedFilter,
          context.actorId.toString()
        );
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
        let effectiveView =
          query.viewId && !query.ignoreViewQuery
            ? yield* table.getViewById(query.viewId)
            : undefined;
        if (!effectiveView && linkCandidatePlan?.filterByViewId && !query.ignoreViewQuery) {
          const fallbackViewResult = table.getViewById(linkCandidatePlan.filterByViewId);
          if (fallbackViewResult.isOk()) {
            effectiveView = fallbackViewResult.value;
          }
        }
        const effectiveQueryDefaults = effectiveView
          ? yield* effectiveView.queryDefaults()
          : undefined;
        const defaultFilter = replaceCurrentUserTagInFilter(
          table,
          effectiveQueryDefaults?.filter(),
          context.actorId.toString()
        );
        const sanitizedDefaultFilter = yield* sanitizeRecordFilter(table, defaultFilter);
        const permissionSanitizedDefaultFilter = yield* sanitizeFilterByEnabledFieldIds(
          sanitizedDefaultFilter ?? undefined,
          enabledFieldIds,
          maskedFieldIds,
          'strip'
        );
        const permissionValidatedClientFilter = yield* sanitizeFilterByEnabledFieldIds(
          actorResolvedFilter,
          enabledFieldIds,
          maskedFieldIds,
          'reject'
        );
        const effectiveFilter = mergeFilterWithViewDefaults(
          permissionSanitizedDefaultFilter,
          permissionValidatedClientFilter
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
        const rowScopeSpec =
          query.queryScope?.skipRecordSpec || !query.queryScope?.recordSpec
            ? undefined
            : query.queryScope.recordSpec;
        const spec = composeAndSpecsOrUndefined(
          [builtQueryPlan.spec, rowScopeSpec].filter(
            (
              candidate
            ): candidate is ISpecification<TableRecord, ITableRecordConditionSpecVisitor> =>
              candidate != null
          )
        );

        const requestedSearch = RecordSearch.fromOptionalTuple(query.search);

        const searchVisibleFieldIds = filterFieldIdsByQueryAccess(
          query.viewId && !query.ignoreViewQuery
            ? yield* table.getOrderedVisibleFieldIds(query.viewId)
            : table.fieldIds(),
          enabledFieldIds,
          maskedFieldIds
        );
        const projectionFieldIds = yield* resolveProjectionFieldIds(
          table,
          query.projection,
          query.fieldKeyType,
          enabledFieldIds
        );
        const narrowSearchToProjection =
          query.searchFieldScope === 'projection' ||
          (query.searchFieldScope !== 'visible' && Boolean(query.projection?.length));
        const projectedSearchVisibleFieldIds =
          narrowSearchToProjection && projectionFieldIds?.length
            ? searchVisibleFieldIds.filter((fieldId) =>
                projectionFieldIds.some((projectedFieldId) => projectedFieldId.equals(fieldId))
              )
            : searchVisibleFieldIds;
        const visibleRowSearch = resolveVisibleRowSearch(
          requestedSearch,
          projectedSearchVisibleFieldIds
        );

        const countOptions: ITableRecordCountOptions = {
          mode: 'stored',
          search: visibleRowSearch,
          recordReadQuerySource: query.recordReadQuerySource,
          searchAccessPath: query.recordSearchAccessPath,
          fieldMasks: query.queryScope?.fieldMasks,
        };
        const count = yield* await this.tableRecordQueryRepository.count(
          context,
          table,
          spec,
          countOptions
        );

        logger.debug('CountTableRecordsHandler.success', { count });
        return ok(CountTableRecordsResult.create(count));
      }.bind(this)
    ).orElse((error) => {
      logger.error('CountTableRecordsHandler.failed', { error: error.toString() });
      return err(error);
    });
  }
}
