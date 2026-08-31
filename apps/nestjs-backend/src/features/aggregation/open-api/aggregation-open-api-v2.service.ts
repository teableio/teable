import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { FieldKeyType, HttpErrorCode } from '@teable/core';
import type {
  IAggregationRo,
  IAggregationVo,
  ICalendarDailyCollectionRo,
  ICalendarDailyCollectionVo,
  IGroupPointsRo,
  IGroupPointsVo,
  IRowCountRo,
  IRowCountVo,
  ISearchCountRo,
  ISearchCountVo,
  ISearchIndexByQueryRo,
  ISearchIndexVo,
} from '@teable/openapi';
import { mapTableRecordToDto } from '@teable/v2-contract-http';
import { executeListTableRecordsEndpoint } from '@teable/v2-contract-http-implementation/handlers';
import {
  AggregateTableRecordsQuery,
  CountTableRecordsQuery,
  type AggregateTableRecordsResult,
  type AttachmentValueDecoratorService,
  type CountTableRecordsResult,
  GetCalendarDailyCollectionQuery,
  type GetCalendarDailyCollectionResult,
  type IExecutionContext,
  type IQueryBus,
  type ITableRepository,
  MAX_RECORDS_LIMIT,
  RecordQueryOperationKind,
  type RecordQueryPluginRunner,
  type RecordQueryPluginScope,
  type Table,
  TableByIdSpec,
  TableId,
  v2CoreTokens,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { type IThresholdConfig, ThresholdConfig } from '../../../configs/threshold.config';
import { CustomHttpException } from '../../../custom.exception';
import { V2ContainerService } from '../../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../../v2/v2-execution-context.factory';
import { throwV2Error } from '../../v2/v2-http-error';
import {
  mapAggregationResult,
  mapGroupPointsResult,
  normalizeLegacyFilterViaQueryBus,
  throwV2QueryDomainError,
} from './aggregation-v2-result.mapper';

interface IPreparedV2Read {
  container: DependencyContainer;
  context: IExecutionContext;
  queryBus: IQueryBus;
  queryScope?: RecordQueryPluginScope;
}

/**
 * V2 read path for the authed `/api/table/:tableId/aggregation` routes.
 *
 * Each `try*` method returns `undefined` when the request cannot be served by
 * the v2 query bus with v1-identical semantics — the caller must then fall
 * back to the v1 implementation. Aggregate/calendar reads still fail closed
 * when their query types cannot thread a restricted plugin scope. Row-count
 * and search-count use CountTableRecordsQuery and carry the same queryScope as
 * list records, preserving masked filters and row-scope intersection.
 */
@Injectable()
export class AggregationOpenApiV2Service {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  async tryGetRowCount(tableId: string, query: IRowCountRo = {}): Promise<IRowCountVo | undefined> {
    const prepared = await this.prepareV2Read(tableId, query.viewId, query.ignoreViewQuery, {
      allowRestrictedScope: true,
    });
    if (!prepared) {
      return undefined;
    }
    const { context, queryBus } = prepared;
    const filter = await normalizeLegacyFilterViaQueryBus(
      tableId,
      query.filter,
      context.actorId.toString(),
      queryBus,
      context
    );
    const scopedProjection =
      query.projection?.length && query.search ? query.projection : undefined;
    const rowCount = await this.executeCountQuery(prepared, {
      tableId,
      viewId: query.viewId,
      ignoreViewQuery: query.ignoreViewQuery,
      filter,
      search: query.search,
      projection: scopedProjection,
      searchFieldScope: scopedProjection ? 'projection' : undefined,
      filterLinkCellSelected: query.filterLinkCellSelected,
      filterLinkCellCandidate: query.filterLinkCellCandidate,
      selectedRecordIds: query.selectedRecordIds,
    });
    return { rowCount };
  }

  async tryGetAggregation(
    tableId: string,
    query: IAggregationRo = {}
  ): Promise<IAggregationVo | undefined> {
    // The v2 aggregate query always evaluates within a view.
    if (!query.viewId || query.ignoreViewQuery) {
      return undefined;
    }
    // Link-cell and selection filters are not expressible on the v2 aggregate query.
    if (
      query.filterLinkCellCandidate ||
      query.filterLinkCellSelected ||
      query.selectedRecordIds?.length
    ) {
      return undefined;
    }
    const prepared = await this.prepareV2Read(tableId, query.viewId, query.ignoreViewQuery);
    if (!prepared) {
      return undefined;
    }
    const { context, queryBus } = prepared;
    const filter = await normalizeLegacyFilterViaQueryBus(
      tableId,
      query.filter,
      context.actorId.toString(),
      queryBus,
      context
    );
    const requestedFields = query.field
      ? Object.entries(query.field).flatMap(([statisticFunc, fieldIds]) =>
          (fieldIds ?? []).map((fieldId) => ({ fieldId, statisticFunc }))
        )
      : undefined;
    const result = await this.executeAggregateQuery(prepared, {
      tableId,
      viewId: query.viewId,
      filter,
      search: query.search,
      fields: requestedFields?.length ? requestedFields : undefined,
      groupBy: query.groupBy ?? undefined,
    });
    return mapAggregationResult(result, query.groupBy ?? undefined);
  }

  async tryGetGroupPoints(
    tableId: string,
    query: IGroupPointsRo = {}
  ): Promise<IGroupPointsVo | undefined> {
    const groupBy = query.groupBy?.slice(0, 3);
    if (!query.viewId || query.ignoreViewQuery || !groupBy?.length) {
      return undefined;
    }
    const prepared = await this.prepareV2Read(tableId, query.viewId, query.ignoreViewQuery);
    if (!prepared) {
      return undefined;
    }
    const { container, context, queryBus } = prepared;
    const filter = await normalizeLegacyFilterViaQueryBus(
      tableId,
      query.filter,
      context.actorId.toString(),
      queryBus,
      context
    );
    const result = await this.executeAggregateQuery(prepared, {
      tableId,
      viewId: query.viewId,
      filter,
      search: query.search,
      fields: [{ fieldId: groupBy[0].fieldId, statisticFunc: 'count' }],
      groupBy,
    });
    const attachmentDecorator = container.resolve<AttachmentValueDecoratorService>(
      v2CoreTokens.attachmentValueDecoratorService
    );
    return mapGroupPointsResult(result, new Set(query.collapsedGroupIds), attachmentDecorator);
  }

  async tryGetCalendarDailyCollection(
    tableId: string,
    query: ICalendarDailyCollectionRo
  ): Promise<ICalendarDailyCollectionVo | undefined> {
    if (!query.viewId || query.ignoreViewQuery) {
      return undefined;
    }
    const prepared = await this.prepareV2Read(tableId, query.viewId, query.ignoreViewQuery);
    if (!prepared) {
      return undefined;
    }
    const { context, queryBus } = prepared;
    const filter = await normalizeLegacyFilterViaQueryBus(
      tableId,
      query.filter,
      context.actorId.toString(),
      queryBus,
      context
    );
    const calendarQuery = GetCalendarDailyCollectionQuery.create({
      tableId,
      viewId: query.viewId,
      startDate: query.startDate,
      endDate: query.endDate,
      startDateFieldId: query.startDateFieldId,
      endDateFieldId: query.endDateFieldId,
      filter,
      search: query.search,
    });
    if (calendarQuery.isErr()) {
      throwV2QueryDomainError(calendarQuery.error);
    }
    const result = await queryBus.execute<
      GetCalendarDailyCollectionQuery,
      GetCalendarDailyCollectionResult
    >(context, calendarQuery.value);
    if (result.isErr()) {
      throwV2QueryDomainError(result.error);
    }

    const records = result.value.records.map((record) => {
      const dto = mapTableRecordToDto(record);
      if (dto.isErr()) {
        throwV2QueryDomainError(dto.error);
      }
      return dto.value;
    });
    return { countMap: { ...result.value.countMap }, records };
  }

  async tryGetSearchCount(
    tableId: string,
    query: ISearchCountRo,
    projection?: string[]
  ): Promise<ISearchCountVo | undefined> {
    this.assertSearchQuery(query.search);
    const prepared = await this.prepareV2Read(tableId, query.viewId, query.ignoreViewQuery, {
      allowRestrictedScope: true,
    });
    if (!prepared) {
      return undefined;
    }
    const { context, queryBus } = prepared;
    const [searchValue, searchFieldKeys] = query.search;
    const filter = await normalizeLegacyFilterViaQueryBus(
      tableId,
      query.filter,
      context.actorId.toString(),
      queryBus,
      context
    );
    const scopedProjection = projection?.length ? projection : undefined;
    const count = await this.executeCountQuery(prepared, {
      tableId,
      viewId: query.viewId,
      ignoreViewQuery: query.ignoreViewQuery,
      filter,
      search: [searchValue, searchFieldKeys ?? '', true],
      projection: scopedProjection,
      searchFieldScope: scopedProjection ? 'projection' : undefined,
    });
    return { count };
  }

  async tryGetSearchIndex(
    tableId: string,
    query: ISearchIndexByQueryRo,
    projection?: string[]
  ): Promise<ISearchIndexVo | undefined> {
    if (query.take > 1000) {
      throw new CustomHttpException(
        'The maximum search index result is 1000',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.aggregation.maxSearchIndexResult',
          },
        }
      );
    }
    this.assertSearchQuery(query.search);
    const prepared = await this.prepareV2Read(tableId, query.viewId, query.ignoreViewQuery, {
      allowRestrictedScope: true,
    });
    if (!prepared) {
      return undefined;
    }
    const { context, queryBus, queryScope } = prepared;
    const [searchValue, searchFieldKeys, hideNotMatchRow] = query.search;
    const filter = await normalizeLegacyFilterViaQueryBus(
      tableId,
      query.filter,
      context.actorId.toString(),
      queryBus,
      context
    );
    const finalProjection = query.projection
      ? projection
        ? projection.filter((fieldId) => query.projection?.includes(fieldId))
        : query.projection
      : projection;
    const sort = [...(query.groupBy ?? []), ...(query.orderBy ?? [])].map((item) => ({
      fieldId: item.fieldId,
      order: item.order,
    }));

    const result = await executeListTableRecordsEndpoint(
      context,
      {
        tableId,
        fieldKeyType: FieldKeyType.Id,
        limit: query.take > 0 ? query.take : MAX_RECORDS_LIMIT,
        offset: query.skip ?? 0,
        includeTotal: false,
        includeSearchMatches: true,
        searchIndexMode: hideNotMatchRow ? 'matched' : 'view',
        search: [searchValue, searchFieldKeys ?? '', true],
        ...(query.viewId ? { viewId: query.viewId } : {}),
        ...(query.ignoreViewQuery !== undefined ? { ignoreViewQuery: query.ignoreViewQuery } : {}),
        ...(filter ? { filter } : {}),
        ...(sort.length ? { sort } : {}),
        ...(query.groupBy?.length ? { groupBy: query.groupBy.map((item) => item.fieldId) } : {}),
        ...(finalProjection?.length ? { projection: finalProjection } : {}),
        ...(query.filterLinkCellSelected
          ? { filterLinkCellSelected: query.filterLinkCellSelected }
          : {}),
        ...(query.filterLinkCellCandidate
          ? { filterLinkCellCandidate: query.filterLinkCellCandidate }
          : {}),
        ...(query.selectedRecordIds?.length ? { selectedRecordIds: query.selectedRecordIds } : {}),
      },
      queryBus,
      { queryScope }
    );

    if (result.status === 200 && result.body.ok) {
      const matches = result.body.data.searchMatches;
      if (!matches?.length) {
        return null;
      }
      return matches.map((match) => ({
        index: match.index,
        fieldId: match.fieldId,
        recordId: match.recordId,
      }));
    }
    if (!result.body.ok) {
      throwV2Error(result.body.error, result.status);
    }
    throw new HttpException('Internal server error', HttpStatus.INTERNAL_SERVER_ERROR);
  }

  private assertSearchQuery(
    search: ISearchCountRo['search']
  ): asserts search is NonNullable<ISearchCountRo['search']> {
    if (!search) {
      throw new CustomHttpException('Search query is required', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.aggregation.searchQueryRequired',
        },
      });
    }
  }

  private async executeCountQuery(
    prepared: IPreparedV2Read,
    input: {
      tableId: string;
      viewId?: string;
      ignoreViewQuery?: boolean;
      filter?: unknown;
      search?: IRowCountRo['search'];
      projection?: string[];
      searchFieldScope?: 'projection' | 'visible';
      filterLinkCellSelected?: IRowCountRo['filterLinkCellSelected'];
      filterLinkCellCandidate?: IRowCountRo['filterLinkCellCandidate'];
      selectedRecordIds?: IRowCountRo['selectedRecordIds'];
    }
  ): Promise<number> {
    const countQuery = CountTableRecordsQuery.create(
      {
        tableId: input.tableId,
        fieldKeyType: FieldKeyType.Id,
        ...(input.viewId ? { viewId: input.viewId } : {}),
        ...(input.ignoreViewQuery !== undefined ? { ignoreViewQuery: input.ignoreViewQuery } : {}),
        ...(input.filter ? { filter: input.filter } : {}),
        ...(input.search ? { search: input.search } : {}),
        ...(input.projection?.length ? { projection: input.projection } : {}),
        ...(input.filterLinkCellSelected
          ? { filterLinkCellSelected: input.filterLinkCellSelected }
          : {}),
        ...(input.filterLinkCellCandidate
          ? { filterLinkCellCandidate: input.filterLinkCellCandidate }
          : {}),
        ...(input.selectedRecordIds?.length ? { selectedRecordIds: input.selectedRecordIds } : {}),
      },
      {
        queryScope: prepared.queryScope,
        ...(input.searchFieldScope ? { searchFieldScope: input.searchFieldScope } : {}),
      }
    );
    if (countQuery.isErr()) {
      throwV2QueryDomainError(countQuery.error);
    }
    const result = await prepared.queryBus.execute<CountTableRecordsQuery, CountTableRecordsResult>(
      prepared.context,
      countQuery.value
    );
    if (result.isErr()) {
      throwV2QueryDomainError(result.error);
    }
    return result.value.count;
  }

  private async executeAggregateQuery(
    prepared: IPreparedV2Read,
    input: {
      tableId: string;
      viewId: string;
      filter: unknown;
      search: unknown;
      fields?: ReadonlyArray<{ fieldId: string; statisticFunc: string }>;
      // Validated by AggregateTableRecordsQuery.create; v1 ROs type `order`
      // as SortFunc, which the zod schema narrows to 'asc' | 'desc'.
      groupBy?: ReadonlyArray<{ fieldId: string; order: string }>;
    }
  ): Promise<AggregateTableRecordsResult> {
    const aggregationQuery = AggregateTableRecordsQuery.create(input, {
      maxGroupPoints: this.thresholdConfig.maxGroupPoints,
    });
    if (aggregationQuery.isErr()) {
      throwV2QueryDomainError(aggregationQuery.error);
    }
    const result = await prepared.queryBus.execute<
      AggregateTableRecordsQuery,
      AggregateTableRecordsResult
    >(prepared.context, aggregationQuery.value);
    if (result.isErr()) {
      throwV2QueryDomainError(result.error);
    }
    return result.value;
  }

  /**
   * Resolve the v2 container/context and run the record query plugin guard.
   * Returns undefined when the resulting plugin scope restricts rows or
   * fields — the aggregate queries below cannot enforce it, so v1 keeps
   * authority for those requests.
   */
  private async prepareV2Read(
    tableId: string,
    viewId: string | undefined,
    ignoreViewQuery: boolean | undefined,
    options?: { allowRestrictedScope?: boolean }
  ): Promise<IPreparedV2Read | undefined> {
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const context = await this.v2ContextFactory.createContext(container);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);

    if (container.isRegistered(v2CoreTokens.recordQueryPluginRunner)) {
      const table = await this.loadTable(context, container, tableId);
      const runner = container.resolve<RecordQueryPluginRunner>(
        v2CoreTokens.recordQueryPluginRunner
      );
      const prepared = await runner.prepare({
        kind: RecordQueryOperationKind.list,
        executionContext: context,
        table,
        payload: { viewId, ignoreViewQuery },
      });
      if (prepared.isErr()) {
        throwV2QueryDomainError(prepared.error);
      }
      const execution = prepared.value;
      const guardResult = await execution.guard();
      if (guardResult.isErr()) {
        throwV2QueryDomainError(guardResult.error);
      }
      const scopeResult = execution.getScope();
      if (scopeResult.isErr()) {
        throwV2QueryDomainError(scopeResult.error);
      }
      const queryScope = scopeResult.value;
      if (this.queryScopeRestrictsAccess(queryScope) && !options?.allowRestrictedScope) {
        return undefined;
      }
      return { container, context, queryBus, queryScope };
    }

    return { container, context, queryBus };
  }

  private queryScopeRestrictsAccess(scope: RecordQueryPluginScope | undefined): boolean {
    if (!scope) {
      return false;
    }
    return Boolean(
      scope.recordSpec ||
        scope.fieldMasks?.length ||
        scope.readableFieldIds != null ||
        scope.skipRecordSpec
    );
  }

  private async loadTable(
    context: IExecutionContext,
    container: DependencyContainer,
    tableId: string
  ): Promise<Table> {
    const tableIdResult = TableId.create(tableId);
    if (tableIdResult.isErr()) {
      throwV2QueryDomainError(tableIdResult.error);
    }
    const tableRepository = container.resolve<ITableRepository>(v2CoreTokens.tableRepository);
    const tableResult = await tableRepository.findOne(
      context,
      TableByIdSpec.create(tableIdResult.value)
    );
    if (tableResult.isErr()) {
      throwV2QueryDomainError(tableResult.error);
    }
    return tableResult.value;
  }
}
