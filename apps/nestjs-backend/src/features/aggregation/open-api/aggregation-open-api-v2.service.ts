import { AsyncLocalStorage } from 'node:async_hooks';
import { HttpException, HttpStatus, Injectable, Optional } from '@nestjs/common';
import { FieldKeyType, HttpErrorCode } from '@teable/core';
import type {
  IAggregationRo,
  IAggregationVo,
  ICalendarDailyCollectionRo,
  ICalendarDailyCollectionVo,
  IGroupPointsRo,
  IGroupPointsVo,
  IRecordIndexRo,
  IRecordIndexVo,
  IRowCountRo,
  IRowCountVo,
  ISearchCountRo,
  ISearchCountVo,
  ISearchIndexByQueryRo,
  ISearchIndexVo,
  ISelectionAggregationRo,
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
  ListTableRecordsQuery,
  type ListTableRecordsResult,
  MAX_RECORDS_LIMIT,
  RecordQueryOperationKind,
  type RecordQueryPluginRunner,
  type RecordQueryPluginScope,
  type Table,
  TableByIdSpec,
  isTableProvisionPendingError,
  TableId,
  v2CoreTokens,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { type IThresholdConfig, ThresholdConfig } from '../../../configs/threshold.config';
import { CustomHttpException } from '../../../custom.exception';
import { TableQuerySearchVectorRuntimeService } from '../../v2/table-query-search-vector-runtime.service';
import { V2ContainerService } from '../../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../../v2/v2-execution-context.factory';
import { throwV2Error } from '../../v2/v2-http-error';
import {
  mapAggregationResult,
  mapGroupPointsResult,
  normalizeLegacyFilterViaQueryBus,
  throwV2QueryDomainError,
} from './aggregation-v2-result.mapper';

import { provisionReadyCache } from './provision-ready-cache';

interface IPreparedV2TableRead {
  container: DependencyContainer;
  context: IExecutionContext;
  queryBus: IQueryBus;
  table: Table;
  viewId?: string;
  queryScope?: RecordQueryPluginScope;
}

/**
 * V2 read path for the authed `/api/table/:tableId/aggregation` routes.
 *
 * All selected-v2 requests execute natively. The host prepares the same
 * permission scope used by record reads; each query enforces its row
 * restrictions, readable fields, and field masks.
 */
@Injectable()
export class AggregationOpenApiV2Service {
  private readonly provisionNoWait = new AsyncLocalStorage<boolean>();

  /** Cache hits are immediate; cache misses probe outside the cache's lock. */
  async withProvisionReadyCache<T>(
    tableId: string,
    getCached: () => Promise<{ data: T } | null>,
    load: () => Promise<T>
  ): Promise<T> {
    const raw = process.env.V2_TABLE_PROVISION_READY_WAIT_MS;
    const configured = raw == null || raw.trim() === '' ? 10_000 : Number(raw);
    const budget = Number.isFinite(configured) && configured >= 0 ? Math.floor(configured) : 10_000;
    return provisionReadyCache({
      getCached,
      budgetMs: budget,
      wait: async (remainingMs) => {
        const preparationStarted = Date.now();
        const container = await this.v2ContainerService.getContainerForTable(tableId);
        const context = await this.v2ContextFactory.createContext(container);
        const repository = container.resolve<ITableRepository>(v2CoreTokens.tableRepository);
        const id = TableId.create(tableId);
        if (id.isErr()) throwV2QueryDomainError(id.error);
        if (!repository.waitForReady)
          throw new Error('Table repository does not support readiness probes');
        const ready = await repository.waitForReady(context, TableByIdSpec.create(id.value), {
          provisionWaitMs: Math.max(0, remainingMs - (Date.now() - preparationStarted)),
        });
        if (ready.isErr()) throwV2QueryDomainError(ready.error);
      },
      loadWithoutWait: () => this.provisionNoWait.run(true, load),
      isPending: (error) =>
        error instanceof CustomHttpException &&
        isTableProvisionPendingError({ code: error.data?.domainCode }),
    });
  }

  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    @Optional()
    private readonly tableQuerySearchVectorRuntimeService?: TableQuerySearchVectorRuntimeService
  ) {}

  async getRowCount(tableId: string, query: IRowCountRo = {}): Promise<IRowCountVo> {
    const prepared = await this.prepareV2TableRead(tableId, query.viewId, query.ignoreViewQuery);
    const { context, queryBus } = prepared;
    const filter = await normalizeLegacyFilterViaQueryBus(
      tableId,
      query.filter,
      context.actorId.toString(),
      queryBus,
      context,
      prepared.table
    );
    const scopedProjection =
      query.projection?.length && query.search ? query.projection : undefined;
    const rowCount = await this.executeCountQuery(prepared, {
      tableId,
      viewId: prepared.viewId,
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

  async getAggregation(tableId: string, query: IAggregationRo = {}): Promise<IAggregationVo> {
    const prepared = await this.prepareV2TableRead(tableId, query.viewId, query.ignoreViewQuery);
    const { context, queryBus } = prepared;
    const filter = await normalizeLegacyFilterViaQueryBus(
      tableId,
      query.filter,
      context.actorId.toString(),
      queryBus,
      context,
      prepared.table
    );
    const requestedFields = query.field
      ? Object.entries(query.field).flatMap(([statisticFunc, fieldIds]) =>
          (fieldIds ?? []).map((fieldId) => ({ fieldId, statisticFunc }))
        )
      : undefined;
    const result = await this.executeAggregateQuery(prepared, {
      tableId,
      viewId: prepared.viewId,
      ignoreViewQuery: query.ignoreViewQuery,
      filterLinkCellSelected: query.filterLinkCellSelected,
      filterLinkCellCandidate: query.filterLinkCellCandidate,
      selectedRecordIds: query.selectedRecordIds,
      filter,
      search: query.search,
      fields: requestedFields?.length ? requestedFields : undefined,
      groupBy: query.groupBy ?? undefined,
    });
    return mapAggregationResult(result);
  }

  async getSelectionAggregation(
    tableId: string,
    query: ISelectionAggregationRo
  ): Promise<IAggregationVo> {
    const prepared = await this.prepareV2TableRead(tableId, query.viewId, query.ignoreViewQuery);
    const { context, queryBus } = prepared;
    const filter = await normalizeLegacyFilterViaQueryBus(
      tableId,
      query.filter,
      context.actorId.toString(),
      queryBus,
      context,
      prepared.table
    );
    const groupBy = (query.groupBy ?? []).map((item) => ({
      fieldId: item.fieldId,
      order: item.order,
    }));
    const requestedFields = query.field
      ? Object.entries(query.field).flatMap(([statisticFunc, fieldIds]) =>
          (fieldIds ?? []).map((fieldId) => ({ fieldId, statisticFunc }))
        )
      : undefined;
    const orderBy = (query.orderBy ?? []).map((item) => ({
      fieldId: item.fieldId,
      order: item.order,
    }));
    const result = await this.executeAggregateQuery(prepared, {
      tableId,
      viewId: prepared.viewId,
      filterLinkCellSelected: query.filterLinkCellSelected,
      filterLinkCellCandidate: query.filterLinkCellCandidate,
      selectedRecordIds: query.selectedRecordIds,
      filter,
      search: query.search,
      fields: requestedFields?.length ? requestedFields : undefined,
      groupBy: groupBy.length ? groupBy : undefined,
      orderBy: orderBy.length ? orderBy : undefined,
      skip: query.skip,
      take: query.take,
      ignoreViewQuery: query.ignoreViewQuery,
      collapsedGroupIds: query.collapsedGroupIds,
    });
    return mapAggregationResult(result);
  }

  async getGroupPoints(tableId: string, query: IGroupPointsRo = {}): Promise<IGroupPointsVo> {
    const prepared = await this.prepareV2TableRead(tableId, query.viewId, query.ignoreViewQuery);
    const groupBy = query.groupBy?.slice(0, 3);
    if (!groupBy?.length) return null;
    const { container, context, queryBus } = prepared;
    const filter = await normalizeLegacyFilterViaQueryBus(
      tableId,
      query.filter,
      context.actorId.toString(),
      queryBus,
      context,
      prepared.table
    );
    const result = await this.executeAggregateQuery(prepared, {
      tableId,
      viewId: prepared.viewId,
      ignoreViewQuery: query.ignoreViewQuery,
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

  async getCalendarDailyCollection(
    tableId: string,
    query: ICalendarDailyCollectionRo
  ): Promise<ICalendarDailyCollectionVo> {
    const prepared = await this.prepareV2TableRead(tableId, query.viewId, query.ignoreViewQuery);
    const { context, queryBus } = prepared;
    const filter = await normalizeLegacyFilterViaQueryBus(
      tableId,
      query.filter,
      context.actorId.toString(),
      queryBus,
      context,
      prepared.table
    );
    const calendarQuery = GetCalendarDailyCollectionQuery.create(
      {
        tableId,
        viewId: prepared.viewId,
        ignoreViewQuery: query.ignoreViewQuery,
        startDate: query.startDate,
        endDate: query.endDate,
        startDateFieldId: query.startDateFieldId,
        endDateFieldId: query.endDateFieldId,
        filter,
        search: query.search,
      },
      {
        queryScope: prepared.queryScope,
        table: prepared.table,
        recordSearchAccessPath: this.tableQuerySearchVectorRuntimeService?.resolveForRecordSearch({
          table: prepared.table,
          search: query.search,
        }),
      }
    );
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

  async getSearchCount(
    tableId: string,
    query: ISearchCountRo,
    projection?: string[]
  ): Promise<ISearchCountVo> {
    this.assertSearchQuery(query.search);
    const prepared = await this.prepareV2TableRead(tableId, query.viewId, query.ignoreViewQuery);
    const { context, queryBus } = prepared;
    const [searchValue, searchFieldKeys] = query.search;
    const filter = await normalizeLegacyFilterViaQueryBus(
      tableId,
      query.filter,
      context.actorId.toString(),
      queryBus,
      context,
      prepared.table
    );
    const scopedProjection = projection?.length ? projection : undefined;
    const count = await this.executeCountQuery(prepared, {
      tableId,
      viewId: prepared.viewId,
      ignoreViewQuery: query.ignoreViewQuery,
      filter,
      search: [searchValue, searchFieldKeys ?? '', true],
      projection: scopedProjection,
      searchFieldScope: scopedProjection ? 'projection' : undefined,
    });
    return { count };
  }

  async getSearchIndex(
    tableId: string,
    query: ISearchIndexByQueryRo,
    projection?: string[]
  ): Promise<ISearchIndexVo> {
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
    const prepared = await this.prepareV2TableRead(tableId, query.viewId, query.ignoreViewQuery);
    const { context, queryBus, queryScope } = prepared;
    const [searchValue, searchFieldKeys, hideNotMatchRow] = query.search;
    const filter = await normalizeLegacyFilterViaQueryBus(
      tableId,
      query.filter,
      context.actorId.toString(),
      queryBus,
      context,
      prepared.table
    );
    const requestedProjection = query.projection;
    let finalProjection = requestedProjection ?? projection;
    if (requestedProjection && projection) {
      finalProjection = projection.filter((fieldId) => requestedProjection.includes(fieldId));
    }
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
        viewId: prepared.viewId,
        ignoreViewQuery: query.ignoreViewQuery,
        filter: filter ?? undefined,
        sort,
        groupBy: query.groupBy?.map((item) => item.fieldId),
        projection: finalProjection?.length ? finalProjection : undefined,
        filterLinkCellSelected: query.filterLinkCellSelected,
        filterLinkCellCandidate: query.filterLinkCellCandidate,
        selectedRecordIds: query.selectedRecordIds,
      },
      queryBus,
      {
        queryScope,
        table: prepared.table,
        recordSearchAccessPath: this.tableQuerySearchVectorRuntimeService?.resolveForRecordSearch({
          table: prepared.table,
          search: query.search,
        }),
      }
    );

    if (!result.body.ok) {
      throwV2Error(result.body.error, result.status);
    }
    if (result.status !== 200) {
      throw new HttpException('Internal server error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const matches = result.body.data.searchMatches;
    if (!matches?.length) return null;
    return matches.map((match) => ({
      index: match.index,
      fieldId: match.fieldId,
      recordId: match.recordId,
    }));
  }
  async getRecordIndex(tableId: string, query: IRecordIndexRo): Promise<IRecordIndexVo> {
    const prepared = await this.prepareV2TableRead(tableId, query.viewId, query.ignoreViewQuery);
    const { context, queryBus, table, queryScope } = prepared;
    let filter = await normalizeLegacyFilterViaQueryBus(
      tableId,
      query.filter,
      context.actorId.toString(),
      queryBus,
      context,
      table
    );
    if (query.collapsedGroupIds?.length && query.groupBy?.length) {
      const grouped = await this.executeAggregateQuery(prepared, {
        tableId,
        viewId: prepared.viewId,
        ignoreViewQuery: query.ignoreViewQuery,
        filter,
        search: query.search,
        fields: [{ fieldId: query.groupBy[0].fieldId, statisticFunc: 'count' }],
        groupBy: query.groupBy,
        filterLinkCellSelected: query.filterLinkCellSelected,
        filterLinkCellCandidate: query.filterLinkCellCandidate,
        selectedRecordIds: query.selectedRecordIds,
      });
      const collapsed = table.createCollapsedGroupExclusionFilter(
        query.groupBy,
        grouped.values.flatMap((value) =>
          value.groupValues?.length === query.groupBy!.length
            ? [{ groupValues: value.groupValues }]
            : []
        ),
        new Set(query.collapsedGroupIds)
      );
      if (collapsed.isErr()) throwV2QueryDomainError(collapsed.error);
      if (collapsed.value) {
        filter = filter
          ? { conjunction: 'and', items: [filter, collapsed.value] }
          : collapsed.value;
      }
    }
    const sort = [...(query.groupBy ?? []), ...(query.orderBy ?? [])];
    const recordSearchAccessPath =
      this.tableQuerySearchVectorRuntimeService?.resolveForRecordSearch({
        table,
        search: query.search,
      });
    const listQuery = ListTableRecordsQuery.create(
      {
        tableId,
        viewId: prepared.viewId,
        ignoreViewQuery: query.ignoreViewQuery,
        filter,
        search: query.search,
        sort: sort.length ? sort : undefined,
        groupBy: query.groupBy?.map((item) => item.fieldId),
        filterLinkCellSelected: query.filterLinkCellSelected,
        filterLinkCellCandidate: query.filterLinkCellCandidate,
        selectedRecordIds: query.selectedRecordIds,
        fieldKeyType: FieldKeyType.Id,
        projection: [],
        includeTotal: false,
      },
      { queryScope, table, recordSearchAccessPath, recordIndexId: query.recordId }
    );
    if (listQuery.isErr()) throwV2QueryDomainError(listQuery.error);
    const result = await queryBus.execute<ListTableRecordsQuery, ListTableRecordsResult>(
      context,
      listQuery.value
    );
    if (result.isErr()) throwV2QueryDomainError(result.error);
    const index = result.value.recordIndex;
    return index == null ? null : { index };
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
    prepared: IPreparedV2TableRead,
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
    const recordSearchAccessPath =
      this.tableQuerySearchVectorRuntimeService?.resolveForRecordSearch({
        table: prepared.table,
        search: input.search,
      });
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
        ...(input.selectedRecordIds !== undefined
          ? { selectedRecordIds: input.selectedRecordIds }
          : {}),
      },
      {
        queryScope: prepared.queryScope,
        table: prepared.table,
        recordSearchAccessPath,
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
    prepared: IPreparedV2TableRead,
    input: {
      tableId: string;
      viewId?: string;
      filter: unknown;
      search: unknown;
      fields?: ReadonlyArray<{ fieldId: string; statisticFunc: string }>;
      // Validated by AggregateTableRecordsQuery.create; v1 ROs type `order`
      // as SortFunc, which the zod schema narrows to 'asc' | 'desc'.
      groupBy?: ReadonlyArray<{ fieldId: string; order: string }>;
      orderBy?: ReadonlyArray<{ fieldId: string; order: string }>;
      skip?: number;
      take?: number;
      ignoreViewQuery?: boolean;
      collapsedGroupIds?: ReadonlyArray<string>;
      filterLinkCellSelected?: IRowCountRo['filterLinkCellSelected'];
      filterLinkCellCandidate?: IRowCountRo['filterLinkCellCandidate'];
      selectedRecordIds?: IRowCountRo['selectedRecordIds'];
    }
  ): Promise<AggregateTableRecordsResult> {
    const recordSearchAccessPath =
      this.tableQuerySearchVectorRuntimeService?.resolveForRecordSearch({
        table: prepared.table,
        search: input.search,
      });
    const aggregationQuery = AggregateTableRecordsQuery.create(input, {
      maxGroupPoints: this.thresholdConfig.maxGroupPoints,
      queryScope: prepared.queryScope,
      table: prepared.table,
      recordSearchAccessPath,
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

  /** Prepare the native record-query authority scope without inventing a view. */
  private async prepareV2TableRead(
    tableId: string,
    viewId: string | undefined,
    ignoreViewQuery: boolean | undefined
  ): Promise<IPreparedV2TableRead> {
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const baseContext = await this.v2ContextFactory.createContext(container);
    const context = this.provisionNoWait.getStore()
      ? { ...baseContext, config: { ...baseContext.config, tableProvisionWaitMs: 0 } }
      : baseContext;
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const table = await this.loadTable(context, container, tableId);

    let queryScope: RecordQueryPluginScope | undefined;
    if (container.isRegistered(v2CoreTokens.recordQueryPluginRunner)) {
      const runner = container.resolve<RecordQueryPluginRunner>(
        v2CoreTokens.recordQueryPluginRunner
      );
      const prepared = await runner.prepare({
        kind: RecordQueryOperationKind.list,
        executionContext: context,
        table,
        payload: { viewId, ignoreViewQuery },
      });
      if (prepared.isErr()) throwV2QueryDomainError(prepared.error);
      const execution = prepared.value;
      const guardResult = await execution.guard();
      if (guardResult.isErr()) throwV2QueryDomainError(guardResult.error);
      const scopeResult = execution.getScope();
      if (scopeResult.isErr()) throwV2QueryDomainError(scopeResult.error);
      queryScope = scopeResult.value;
    }

    return { container, context, queryBus, table, viewId, queryScope };
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
      TableByIdSpec.create(tableIdResult.value),
      { provisionWaitMs: context.config?.tableProvisionWaitMs }
    );
    if (tableResult.isErr()) {
      throwV2QueryDomainError(tableResult.error);
    }
    return tableResult.value;
  }
}
