import { Injectable, Logger } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import {
  CellValueType,
  HttpErrorCode,
  extractFieldIdsFromFilter,
  identify,
  IdPrefix,
  mergeWithDefaultFilter,
  nullsToUndefined,
  ViewType,
} from '@teable/core';
import type { IGridColumnMeta, IFilter, IGroup } from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { StatisticsFunc } from '@teable/openapi';
import type {
  IAggregationField,
  IQueryBaseRo,
  IRawAggregationValue,
  IRawAggregations,
  IRawRowCountValue,
  IGroupPointsRo,
  IGroupPoint,
  ICalendarDailyCollectionRo,
  ICalendarDailyCollectionVo,
  ISearchIndexByQueryRo,
  ISearchCountRo,
  IGetRecordsRo,
  IRecordIndexRo,
  IRecordIndexVo,
} from '@teable/openapi';
import dayjs from 'dayjs';
import { Knex } from 'knex';
import { groupBy, isDate, isEmpty, isString, keyBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { CustomHttpException } from '../../custom.exception';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IClsStore } from '../../types/cls';
import { convertValueToStringify, string2Hash } from '../../utils';
import { createFieldInstanceByRaw, type IFieldInstance } from '../field/model/factory';
import type { DateFieldDto } from '../field/model/field-dto/date-field.dto';
import { InjectRecordQueryBuilder, IRecordQueryBuilder } from '../record/query-builder';
import { RecordPermissionService } from '../record/record-permission.service';
import { RecordService } from '../record/record.service';
import { TableIndexService } from '../table/table-index.service';
import type {
  IAggregationService,
  ICustomFieldStats,
  IWithView,
} from './aggregation.service.interface';

type IStatisticsData = {
  viewId?: string;
  filter?: IFilter;
  statisticFields?: IAggregationField[];
};
/**
 * Version 2 implementation of the aggregation service
 * This is a placeholder implementation that will be developed in the future
 * All methods currently throw NotImplementedException
 */
@Injectable()
export class AggregationService implements IAggregationService {
  private logger = new Logger(AggregationService.name);
  constructor(
    private readonly recordService: RecordService,
    private readonly tableIndexService: TableIndexService,
    private readonly prisma: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    private readonly cls: ClsService<IClsStore>,
    private readonly recordPermissionService: RecordPermissionService,
    @InjectRecordQueryBuilder() private readonly recordQueryBuilder: IRecordQueryBuilder
  ) {}
  /**
   * Perform aggregation operations on table data
   * @param params - Parameters for aggregation including tableId, field IDs, view settings, and search
   * @returns Promise<IRawAggregationValue> - The aggregation results
   * @throws NotImplementedException - This method is not yet implemented
   */
  async performAggregation(params: {
    tableId: string;
    withFieldIds?: string[];
    withView?: IWithView;
    search?: [string, string?, boolean?];
    useQueryModel?: boolean;
  }): Promise<IRawAggregationValue> {
    const { tableId, withFieldIds, withView, search, useQueryModel } = params;
    // Retrieve the current user's ID to build user-related query conditions
    const currentUserId = this.cls.get('user.id');

    const { statisticsData, fieldInstanceMap } = await this.fetchStatisticsParams({
      tableId,
      withView,
      withFieldIds,
    });

    const dbTableName = await this.getDbTableName(this.prisma, tableId);

    const { filter, statisticFields } = statisticsData;
    const groupBy = withView?.groupBy;
    const rawAggregationData = await this.handleAggregation({
      dbTableName,
      fieldInstanceMap,
      tableId,
      filter,
      search,
      statisticFields,
      withUserId: currentUserId,
      withView,
      useQueryModel,
    });

    const aggregationResult = rawAggregationData && rawAggregationData[0];

    const aggregations: IRawAggregations = [];
    if (aggregationResult) {
      for (const [key, value] of Object.entries(aggregationResult)) {
        // Match by alias to ensure uniqueness across different functions of the same field
        const statisticField = statisticFields?.find(
          (item) => item.alias === key || item.fieldId === key
        );
        if (!statisticField) {
          continue;
        }
        const { fieldId, statisticFunc: aggFunc } = statisticField;

        const convertValue = this.formatConvertValue(value, aggFunc);

        if (fieldId) {
          aggregations.push({
            fieldId,
            total: aggFunc ? { value: convertValue, aggFunc: aggFunc } : null,
          });
        }
      }
    }

    const aggregationsWithGroup = await this.performGroupedAggregation({
      aggregations,
      statisticFields,
      tableId,
      filter,
      search,
      groupBy,
      dbTableName,
      fieldInstanceMap,
      withView,
      useQueryModel,
    });

    return { aggregations: aggregationsWithGroup };
  }

  private formatConvertValue = (currentValue: unknown, aggFunc?: StatisticsFunc) => {
    let convertValue = this.convertValueToNumberOrString(currentValue);

    if (!aggFunc) {
      return convertValue;
    }

    if (aggFunc === StatisticsFunc.DateRangeOfMonths && typeof currentValue === 'string') {
      convertValue = this.calculateDateRangeOfMonths(currentValue);
    }

    const defaultToZero = [
      StatisticsFunc.PercentEmpty,
      StatisticsFunc.PercentFilled,
      StatisticsFunc.PercentUnique,
      StatisticsFunc.PercentChecked,
      StatisticsFunc.PercentUnChecked,
    ];

    if (defaultToZero.includes(aggFunc)) {
      convertValue = convertValue ?? 0;
    }
    return convertValue;
  };

  private convertValueToNumberOrString(currentValue: unknown): number | string | null {
    if (typeof currentValue === 'bigint' || typeof currentValue === 'number') {
      return Number(currentValue);
    }
    if (isDate(currentValue)) {
      return currentValue.toISOString();
    }
    return currentValue?.toString() ?? null;
  }

  private calculateDateRangeOfMonths(currentValue: string): number {
    const [maxTime, minTime] = currentValue.split(',');
    return maxTime && minTime ? dayjs(maxTime).diff(minTime, 'month') : 0;
  }
  private async handleAggregation(params: {
    dbTableName: string;
    fieldInstanceMap: Record<string, IFieldInstance>;
    tableId: string;
    filter?: IFilter;
    groupBy?: IGroup;
    search?: [string, string?, boolean?];
    statisticFields?: IAggregationField[];
    withUserId?: string;
    withView?: IWithView;
    useQueryModel?: boolean;
  }) {
    const {
      dbTableName,
      fieldInstanceMap,
      filter,
      search,
      statisticFields,
      withUserId,
      groupBy,
      withView,
      tableId,
      useQueryModel,
    } = params;

    if (!statisticFields?.length) {
      return;
    }

    const { viewId } = withView || {};

    // Probe permission to get enabled field IDs for CTE projection
    const permissionProbe = await this.recordPermissionService.wrapView(
      tableId,
      this.knex.queryBuilder(),
      { viewId }
    );
    const allowedFieldIds = permissionProbe.enabledFieldIds;

    const searchFields = await this.recordService.getSearchFields(
      fieldInstanceMap,
      search,
      viewId,
      allowedFieldIds
    );

    const projection = this.resolveAggregationProjection({
      statisticFields,
      groupBy,
      filter,
      searchFields,
      allowedFieldIds,
    });

    // Build aggregate query using the permission-aware builder so the CTE is preserved
    const { qb, selectionMap } = await this.recordQueryBuilder.createRecordAggregateBuilder(
      permissionProbe.viewCte ?? dbTableName,
      {
        tableId,
        viewId,
        filter,
        aggregationFields: statisticFields,
        groupBy,
        currentUserId: withUserId,
        // Limit link/lookup CTEs to enabled fields so denied fields resolve to NULL
        projection,
        useQueryModel,
        builder: permissionProbe.builder,
      }
    );

    if (search && search[2] && searchFields?.length) {
      const tableIndex = await this.tableIndexService.getActivatedTableIndexes(tableId);
      qb.where((builder) => {
        this.dbProvider.searchQuery(builder, searchFields, tableIndex, search, { selectionMap });
      });
    }

    if (groupBy?.length) {
      qb.limit(this.thresholdConfig.maxGroupPoints);
    }

    const aggSql = qb.toQuery();
    this.logger.debug('handleAggregation aggSql: %s', aggSql);
    return this.prisma.$queryRawUnsafe<{ [field: string]: unknown }[]>(aggSql);
  }
  /**
   * Perform grouped aggregation operations
   * @param params - Parameters for grouped aggregation
   * @returns Promise<IRawAggregations> - The grouped aggregation results
   * @throws NotImplementedException - This method is not yet implemented
   */

  async performGroupedAggregation(params: {
    aggregations: IRawAggregations;
    statisticFields: IAggregationField[] | undefined;
    tableId: string;
    filter?: IFilter;
    search?: [string, string?, boolean?];
    groupBy?: IGroup;
    dbTableName: string;
    fieldInstanceMap: Record<string, IFieldInstance>;
    withView?: IWithView;
    useQueryModel?: boolean;
  }) {
    const {
      dbTableName,
      aggregations,
      statisticFields,
      filter,
      groupBy,
      search,
      fieldInstanceMap,
      withView,
      tableId,
      useQueryModel,
    } = params;

    if (!groupBy || !statisticFields) return aggregations;

    const currentUserId = this.cls.get('user.id');
    const aggregationByFieldId = keyBy(aggregations, 'fieldId');

    const groupByFields = groupBy.map(({ fieldId }) => {
      return {
        fieldId,
        dbFieldName: fieldInstanceMap[fieldId].dbFieldName,
      };
    });

    for (let i = 0; i < groupBy.length; i++) {
      const rawGroupedAggregationData = (await this.handleAggregation({
        dbTableName,
        fieldInstanceMap,
        tableId,
        filter,
        groupBy: groupBy.slice(0, i + 1),
        search,
        statisticFields,
        withUserId: currentUserId,
        withView,
        useQueryModel,
      }))!;

      const currentGroupFieldId = groupByFields[i].fieldId;

      for (const groupedAggregation of rawGroupedAggregationData) {
        const groupByValueString = groupByFields
          .slice(0, i + 1)
          .map(({ dbFieldName }) => {
            const groupByValue = groupedAggregation[dbFieldName];
            return convertValueToStringify(groupByValue);
          })
          .join('_');
        const flagString = `${currentGroupFieldId}_${groupByValueString}`;
        const groupId = String(string2Hash(flagString));

        for (const statisticField of statisticFields) {
          const { fieldId, statisticFunc, alias } = statisticField;
          // Use unique alias to read the correct aggregated column
          const aggKey = alias ?? `${fieldId}_${statisticFunc}`;
          const curFieldAggregation = aggregationByFieldId[fieldId]!;
          const convertValue = this.formatConvertValue(groupedAggregation[aggKey], statisticFunc);

          if (!curFieldAggregation.group) {
            aggregationByFieldId[fieldId].group = {
              [groupId]: { value: convertValue, aggFunc: statisticFunc },
            };
          } else {
            aggregationByFieldId[fieldId]!.group![groupId] = {
              value: convertValue,
              aggFunc: statisticFunc,
            };
          }
        }
      }
    }

    return Object.values(aggregationByFieldId);
  }

  /**
   * Determine required projection for aggregation query.
   */
  private resolveAggregationProjection(params: {
    statisticFields?: IAggregationField[];
    groupBy?: IGroup;
    filter?: IFilter;
    searchFields?: IFieldInstance[];
    allowedFieldIds?: string[];
  }): string[] | undefined {
    const { statisticFields, groupBy, filter, searchFields, allowedFieldIds } = params;

    const projectionSet = new Set<string>();

    statisticFields?.forEach(({ fieldId }) => {
      if (fieldId && fieldId !== '*') {
        projectionSet.add(fieldId);
      }
    });

    groupBy?.forEach(({ fieldId }) => {
      if (fieldId) {
        projectionSet.add(fieldId);
      }
    });

    if (filter) {
      for (const fieldId of extractFieldIdsFromFilter(filter)) {
        projectionSet.add(fieldId);
      }
    }

    searchFields?.forEach((fieldInstance) => {
      projectionSet.add(fieldInstance.id);
    });

    if (projectionSet.size === 0) {
      return allowedFieldIds && allowedFieldIds.length
        ? Array.from(new Set(allowedFieldIds))
        : undefined;
    }

    const projectionArray = Array.from(projectionSet);

    if (!allowedFieldIds || allowedFieldIds.length === 0) {
      return projectionArray;
    }

    const allowedSet = new Set(allowedFieldIds);
    const filtered = projectionArray.filter((fieldId) => allowedSet.has(fieldId));

    return filtered.length > 0 ? filtered : Array.from(allowedSet);
  }

  /**
   * Get row count for a table with optional filtering
   * @param tableId - The table ID
   * @param queryRo - Query parameters for filtering
   * @returns Promise<IRawRowCountValue> - The row count result
   * @throws NotImplementedException - This method is not yet implemented
   */
  async performRowCount(tableId: string, queryRo: IQueryBaseRo): Promise<IRawRowCountValue> {
    const {
      viewId,
      ignoreViewQuery,
      filterLinkCellCandidate,
      filterLinkCellSelected,
      selectedRecordIds,
      search,
    } = queryRo;
    // Retrieve the current user's ID to build user-related query conditions
    const currentUserId = this.cls.get('user.id');

    const { statisticsData, fieldInstanceMap } = await this.fetchStatisticsParams({
      tableId,
      withView: {
        viewId: ignoreViewQuery ? undefined : viewId,
        customFilter: queryRo.filter,
      },
    });

    const dbTableName = await this.getDbTableName(this.prisma, tableId);

    const { filter } = statisticsData;

    const rawRowCountData = await this.handleRowCount({
      tableId,
      dbTableName,
      fieldInstanceMap,
      filter,
      filterLinkCellCandidate,
      filterLinkCellSelected,
      selectedRecordIds,
      search,
      withUserId: currentUserId,
      viewId: queryRo?.viewId,
    });

    return {
      rowCount: Number(rawRowCountData?.[0]?.count ?? 0),
    };
  }

  private async getDbTableName(prisma: Prisma.TransactionClient, tableId: string) {
    const tableMeta = await prisma.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    return tableMeta.dbTableName;
  }
  private async handleRowCount(params: {
    tableId: string;
    dbTableName: string;
    fieldInstanceMap: Record<string, IFieldInstance>;
    filter?: IFilter;
    filterLinkCellCandidate?: IGetRecordsRo['filterLinkCellCandidate'];
    filterLinkCellSelected?: IGetRecordsRo['filterLinkCellSelected'];
    selectedRecordIds?: IGetRecordsRo['selectedRecordIds'];
    search?: [string, string?, boolean?];
    withUserId?: string;
    viewId?: string;
  }) {
    const {
      tableId,
      dbTableName,
      fieldInstanceMap,
      filter,
      filterLinkCellCandidate,
      filterLinkCellSelected,
      selectedRecordIds,
      search,
      withUserId,
      viewId,
    } = params;

    const restrictRecordIds =
      selectedRecordIds && !filterLinkCellCandidate ? selectedRecordIds : undefined;

    const wrap = await this.recordPermissionService.wrapView(tableId, this.knex.queryBuilder(), {
      viewId,
      keepPrimaryKey: Boolean(filterLinkCellSelected),
    });

    const { qb, alias, selectionMap } = await this.recordQueryBuilder.createRecordAggregateBuilder(
      wrap.viewCte ?? dbTableName,
      {
        tableId,
        viewId,
        currentUserId: withUserId,
        filter,
        aggregationFields: [
          {
            fieldId: '*',
            statisticFunc: StatisticsFunc.Count,
            alias: 'count',
          },
        ],
        restrictRecordIds,
        useQueryModel: true,
        builder: wrap.builder,
      }
    );

    if (search && search[2]) {
      const searchFields = await this.recordService.getSearchFields(
        fieldInstanceMap,
        search,
        viewId
      );
      const tableIndex = await this.tableIndexService.getActivatedTableIndexes(tableId);
      qb.where((builder) => {
        this.dbProvider.searchQuery(builder, searchFields, tableIndex, search, { selectionMap });
      });
    }

    if (selectedRecordIds) {
      filterLinkCellCandidate
        ? qb.whereNotIn(`${alias}.__id`, selectedRecordIds)
        : qb.whereIn(`${alias}.__id`, selectedRecordIds);
    }

    if (filterLinkCellCandidate) {
      await this.recordService.buildLinkCandidateQuery(qb, tableId, filterLinkCellCandidate);
    }

    if (filterLinkCellSelected) {
      await this.recordService.buildLinkSelectedQuery(
        qb,
        tableId,
        dbTableName,
        alias,
        filterLinkCellSelected
      );
    }

    const rawQuery = qb.toQuery();

    this.logger.debug('handleRowCount raw query: %s', rawQuery);
    return await this.prisma.$queryRawUnsafe<{ count: number }[]>(rawQuery);
  }

  private async fetchStatisticsParams(params: {
    tableId: string;
    withView?: IWithView;
    withFieldIds?: string[];
  }): Promise<{
    statisticsData: IStatisticsData;
    fieldInstanceMap: Record<string, IFieldInstance>;
  }> {
    const { tableId, withView, withFieldIds } = params;

    const viewRaw = await this.findView(tableId, withView);

    const { fieldInstances, fieldInstanceMap } = await this.getFieldsData(tableId);
    const filteredFieldInstances = this.filterFieldInstances(
      fieldInstances,
      withView,
      withFieldIds
    );

    const statisticsData = this.buildStatisticsData(filteredFieldInstances, viewRaw, withView);

    return { statisticsData, fieldInstanceMap };
  }

  private async findView(tableId: string, withView?: IWithView) {
    if (!withView?.viewId) {
      return undefined;
    }

    return nullsToUndefined(
      await this.prisma.view.findFirst({
        select: {
          id: true,
          type: true,
          filter: true,
          group: true,
          options: true,
          columnMeta: true,
        },
        where: {
          tableId,
          ...(withView?.viewId ? { id: withView.viewId } : {}),
          type: {
            in: [ViewType.Grid, ViewType.Kanban, ViewType.Gallery, ViewType.Calendar],
          },
          deletedTime: null,
        },
      })
    );
  }

  private filterFieldInstances(
    fieldInstances: IFieldInstance[],
    withView?: IWithView,
    withFieldIds?: string[]
  ) {
    const targetFieldIds =
      withView?.customFieldStats?.map((field) => field.fieldId) ?? withFieldIds;

    return targetFieldIds?.length
      ? fieldInstances.filter((instance) => targetFieldIds.includes(instance.id))
      : fieldInstances;
  }

  private buildStatisticsData(
    filteredFieldInstances: IFieldInstance[],
    viewRaw:
      | {
          id: string | undefined;
          columnMeta: string | undefined;
          filter: string | undefined;
          group: string | undefined;
        }
      | undefined,
    withView?: IWithView
  ) {
    let statisticsData: IStatisticsData = {
      viewId: viewRaw?.id,
    };

    if (viewRaw?.filter || withView?.customFilter) {
      const filter = mergeWithDefaultFilter(viewRaw?.filter, withView?.customFilter);
      statisticsData = { ...statisticsData, filter };
    }

    if (viewRaw?.id || withView?.customFieldStats) {
      const statisticFields = this.getStatisticFields(
        filteredFieldInstances,
        viewRaw?.columnMeta && JSON.parse(viewRaw.columnMeta),
        withView?.customFieldStats
      );
      statisticsData = { ...statisticsData, statisticFields };
    }
    return statisticsData;
  }

  private getStatisticFields(
    fieldInstances: IFieldInstance[],
    columnMeta?: IGridColumnMeta,
    customFieldStats?: ICustomFieldStats[]
  ) {
    let calculatedStatisticFields: IAggregationField[] | undefined;
    const customFieldStatsGrouped = groupBy(customFieldStats, 'fieldId');

    fieldInstances.forEach((fieldInstance) => {
      const { id: fieldId } = fieldInstance;
      const viewColumnMeta = columnMeta ? columnMeta[fieldId] : undefined;
      const customFieldStats = customFieldStatsGrouped[fieldId];

      if (viewColumnMeta || customFieldStats) {
        const { hidden, statisticFunc } = viewColumnMeta || {};
        const statisticFuncList = customFieldStats
          ?.filter((item) => item.statisticFunc)
          ?.map((item) => item.statisticFunc) as StatisticsFunc[];

        const funcList = !isEmpty(statisticFuncList)
          ? statisticFuncList
          : statisticFunc && [statisticFunc];

        if (hidden !== true && funcList && funcList.length) {
          const statisticFieldList = funcList.map((item) => {
            return {
              fieldId,
              statisticFunc: item,
              // Ensure unique alias per function to avoid collisions in result set
              alias: `${fieldId}_${item}`,
            };
          });
          (calculatedStatisticFields = calculatedStatisticFields ?? []).push(...statisticFieldList);
        }
      }
    });
    return calculatedStatisticFields;
  }
  /**
   * Get field data for a table
   * @param tableId - The table ID
   * @param fieldIds - Optional array of field IDs to filter
   * @param withName - Whether to include field names in the mapping
   * @returns Promise with field instances and field instance map
   * @throws NotImplementedException - This method is not yet implemented
   */

  async getFieldsData(tableId: string, fieldIds?: string[], withName?: boolean) {
    const fieldsRaw = await this.prisma.field.findMany({
      where: { tableId, ...(fieldIds ? { id: { in: fieldIds } } : {}), deletedTime: null },
    });

    const fieldInstances = fieldsRaw.map((field) => createFieldInstanceByRaw(field));
    const fieldInstanceMap = fieldInstances.reduce(
      (map, field) => {
        map[field.id] = field;
        if (withName || withName === undefined) {
          map[field.name] = field;
        }
        return map;
      },
      {} as Record<string, IFieldInstance>
    );
    return { fieldInstances, fieldInstanceMap };
  } /**
   * Get group points for a table
   * @param tableId - The table ID
   * @param query - Optional query parameters
   * @returns Promise with group points data
   * @throws NotImplementedException - This method is not yet implemented
   */
  async getGroupPoints(
    tableId: string,
    query?: IGroupPointsRo,
    useQueryModel = false
  ): Promise<IGroupPoint[]> {
    const { groupPoints } = await this.recordService.getGroupRelatedData(
      tableId,
      query,
      useQueryModel
    );
    return groupPoints;
  }

  /**
   * Get search count for a table
   * @param tableId - The table ID
   * @param queryRo - Search query parameters
   * @param projection - Optional field projection
   * @returns Promise with search count result
   * @throws NotImplementedException - This method is not yet implemented
   */

  public async getSearchCount(tableId: string, queryRo: ISearchCountRo, projection?: string[]) {
    const { search, viewId, ignoreViewQuery } = queryRo;
    const dbFieldName = await this.getDbTableName(this.prisma, tableId);
    const { fieldInstanceMap } = await this.getFieldsData(tableId, undefined, false);

    if (!search) {
      throw new CustomHttpException('Search query is required', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.aggregation.searchQueryRequired',
        },
      });
    }

    const searchFields = await this.recordService.getSearchFields(
      fieldInstanceMap,
      search,
      ignoreViewQuery ? undefined : viewId,
      projection
    );

    if (searchFields?.length === 0) {
      return { count: 0 };
    }
    const tableIndex = await this.tableIndexService.getActivatedTableIndexes(tableId);
    const queryBuilder = this.knex(dbFieldName);

    const selectionMap = new Map(
      Object.values(fieldInstanceMap).map((f) => [f.id, `"${f.dbFieldName}"`])
    );
    this.dbProvider.searchCountQuery(queryBuilder, searchFields, search, tableIndex, {
      selectionMap,
    });
    this.dbProvider
      .filterQuery(
        queryBuilder,
        fieldInstanceMap,
        queryRo?.filter,
        {
          withUserId: this.cls.get('user.id'),
        },
        { selectionMap }
      )
      .appendQueryBuilder();

    const sql = queryBuilder.toQuery();

    const result = await this.prisma.$queryRawUnsafe<{ count: number }[] | null>(sql);

    return {
      count: result ? Number(result[0]?.count) : 0,
    };
  }

  public async getRecordIndexBySearchOrder(
    tableId: string,
    queryRo: ISearchIndexByQueryRo,
    projection?: string[]
  ) {
    const {
      search,
      take,
      skip,
      orderBy,
      filter,
      groupBy,
      viewId,
      ignoreViewQuery,
      projection: queryProjection,
    } = queryRo;
    const dbTableName = await this.getDbTableName(this.prisma, tableId);
    const { fieldInstanceMap } = await this.getFieldsData(tableId, undefined, false);

    if (take > 1000) {
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

    if (!search) {
      throw new CustomHttpException('Search query is required', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.aggregation.searchQueryRequired',
        },
      });
    }

    const finalProjection = queryProjection
      ? projection
        ? projection.filter((fieldId) => queryProjection.includes(fieldId))
        : queryProjection
      : projection;

    const searchFields = await this.recordService.getSearchFields(
      fieldInstanceMap,
      search,
      ignoreViewQuery ? undefined : viewId,
      finalProjection
    );

    if (searchFields.length === 0) {
      return null;
    }

    const selectionMap = new Map(
      Object.values(fieldInstanceMap).map((f) => [f.id, `"${f.dbFieldName}"`])
    );

    const basicSortIndex = await this.recordService.getBasicOrderIndexField(dbTableName, viewId);

    const filterQuery = (qb: Knex.QueryBuilder) => {
      this.dbProvider
        .filterQuery(
          qb,
          fieldInstanceMap,
          filter,
          {
            withUserId: this.cls.get('user.id'),
          },
          { selectionMap }
        )
        .appendQueryBuilder();
    };

    const sortQuery = (qb: Knex.QueryBuilder) => {
      this.dbProvider
        .sortQuery(qb, fieldInstanceMap, [...(groupBy ?? []), ...(orderBy ?? [])], undefined, {
          selectionMap,
        })
        .appendSortBuilder();
    };

    const tableIndex = await this.tableIndexService.getActivatedTableIndexes(tableId);

    const { viewCte, builder } = await this.recordPermissionService.wrapView(
      tableId,
      this.knex.queryBuilder(),
      {
        viewId,
        keepPrimaryKey: Boolean(queryRo.filterLinkCellSelected),
      }
    );

    const queryBuilder = this.dbProvider.searchIndexQuery(
      builder,
      viewCte || dbTableName,
      searchFields,
      queryRo,
      tableIndex,
      { selectionMap },
      basicSortIndex,
      filterQuery,
      sortQuery
    );

    const sql = queryBuilder.toQuery();

    this.logger.debug('getRecordIndexBySearchOrder sql: %s', sql);

    try {
      return await this.prisma.$tx(async (prisma) => {
        const result = await prisma.$queryRawUnsafe<{ __id: string; fieldId: string }[]>(sql);

        // no result found
        if (result?.length === 0) {
          return null;
        }

        const recordIds = result;

        if (search[2]) {
          const baseSkip = skip ?? 0;
          const accRecord: string[] = [];
          return recordIds.map((rec) => {
            if (!accRecord?.includes(rec.__id)) {
              accRecord.push(rec.__id);
            }
            return {
              index: baseSkip + accRecord?.length,
              fieldId: rec.fieldId,
              recordId: rec.__id,
            };
          });
        }

        const { queryBuilder: viewRecordsQB, alias } =
          await this.recordService.buildFilterSortQuery(tableId, queryRo, true);
        // step 2. find the index in current view
        const indexQueryBuilder = this.knex
          .with('t', viewRecordsQB.from({ [alias]: viewCte || dbTableName }))
          .with('t1', (db) => {
            db.select('__id').select(this.knex.raw('ROW_NUMBER() OVER () as row_num')).from('t');
          })
          .select('t1.row_num')
          .select('t1.__id')
          .from('t1')
          .whereIn('t1.__id', [...new Set(recordIds.map((record) => record.__id))]);

        const indexSql = indexQueryBuilder.toQuery();
        this.logger.debug('getRecordIndexBySearchOrder indexSql: %s', indexSql);
        const indexResult =
          // eslint-disable-next-line @typescript-eslint/naming-convention
          await this.prisma.$queryRawUnsafe<{ row_num: number; __id: string }[]>(indexSql);

        if (indexResult?.length === 0) {
          return null;
        }

        const indexResultMap = keyBy(indexResult, '__id');

        return result.map((item) => {
          const index = Number(indexResultMap[item.__id]?.row_num);
          if (isNaN(index)) {
            throw new CustomHttpException('Index not found', HttpErrorCode.NOT_FOUND, {
              localization: {
                i18nKey: 'httpErrors.aggregation.indexNotFound',
              },
            });
          }
          return {
            index,
            fieldId: item.fieldId,
            recordId: item.__id,
          };
        });
      });
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2028') {
        throw new CustomHttpException(`${error.message}`, HttpErrorCode.REQUEST_TIMEOUT, {
          localization: {
            i18nKey: 'httpErrors.aggregation.searchTimeOut',
          },
        });
      }
      throw error;
    }
  }
  async getRecordIndex(tableId: string, queryRo: IRecordIndexRo): Promise<IRecordIndexVo> {
    const { recordId } = queryRo;

    const { queryBuilder: viewRecordsQB, alias } = await this.recordService.buildFilterSortQuery(
      tableId,
      { ...queryRo, skip: undefined, take: undefined },
      true
    );

    const dbTableName = await this.getDbTableName(this.prisma, tableId);

    const { viewCte } = await this.recordPermissionService.wrapView(
      tableId,
      this.knex.queryBuilder(),
      { viewId: queryRo.viewId }
    );

    const indexQueryBuilder = this.knex
      .with('t', viewRecordsQB.from({ [alias]: viewCte || dbTableName }))
      .with('t1', (db) => {
        db.select('__id').select(this.knex.raw('ROW_NUMBER() OVER () as row_num')).from('t');
      })
      .select('t1.row_num')
      .from('t1')
      .where('t1.__id', recordId);

    const sql = indexQueryBuilder.toQuery();
    this.logger.debug('getRecordIndex sql: %s', sql);

    // eslint-disable-next-line @typescript-eslint/naming-convention
    const result = await this.prisma.$queryRawUnsafe<{ row_num: number }[]>(sql);

    if (!result?.length) {
      return null;
    }

    return { index: Number(result[0].row_num) - 1 };
  }

  /**
   * Get calendar daily collection data
   * @param tableId - The table ID
   * @param query - Calendar collection query parameters
   * @returns Promise<ICalendarDailyCollectionVo> - The calendar collection data
   * @throws NotImplementedException - This method is not yet implemented
   */

  public async getCalendarDailyCollection(
    tableId: string,
    query: ICalendarDailyCollectionRo
  ): Promise<ICalendarDailyCollectionVo> {
    const {
      startDate,
      endDate,
      startDateFieldId,
      endDateFieldId,
      filter,
      search,
      ignoreViewQuery,
    } = query;

    if (identify(tableId) !== IdPrefix.Table) {
      throw new CustomHttpException(
        'query collection must be table id',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.aggregation.queryCollectionMustBeTableId',
          },
        }
      );
    }

    const fields = await this.recordService.getFieldsByProjection(tableId);
    const fieldMap = fields.reduce(
      (map, field) => {
        map[field.id] = field;
        return map;
      },
      {} as Record<string, IFieldInstance>
    );

    const startField = fieldMap[startDateFieldId];
    if (
      !startField ||
      startField.cellValueType !== CellValueType.DateTime ||
      startField.isMultipleCellValue
    ) {
      throw new CustomHttpException('Invalid start date field id', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.aggregation.invalidStartDateFieldId',
        },
      });
    }

    const endField = endDateFieldId ? fieldMap[endDateFieldId] : startField;

    if (
      !endField ||
      endField.cellValueType !== CellValueType.DateTime ||
      endField.isMultipleCellValue
    ) {
      throw new CustomHttpException('Invalid end date field id', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.aggregation.invalidEndDateFieldId',
        },
      });
    }

    const viewId = ignoreViewQuery ? undefined : query.viewId;
    const dbTableName = await this.getDbTableName(this.prisma, tableId);
    const { viewCte, builder: queryBuilder } = await this.recordPermissionService.wrapView(
      tableId,
      this.knex.queryBuilder(),
      {
        viewId,
      }
    );
    queryBuilder.from(viewCte || dbTableName);
    const viewRaw = await this.findView(tableId, { viewId });
    const filterStr = viewRaw?.filter;
    const mergedFilter = mergeWithDefaultFilter(filterStr, filter);
    const currentUserId = this.cls.get('user.id');
    const selectionMap = new Map(Object.values(fieldMap).map((f) => [f.id, `"${f.dbFieldName}"`]));

    if (mergedFilter) {
      this.dbProvider
        .filterQuery(
          queryBuilder,
          fieldMap,
          mergedFilter,
          { withUserId: currentUserId },
          { selectionMap }
        )
        .appendQueryBuilder();
    }

    if (search) {
      const searchFields = await this.recordService.getSearchFields(
        fieldMap,
        search,
        query?.viewId
      );
      const tableIndex = await this.tableIndexService.getActivatedTableIndexes(tableId);
      queryBuilder.where((builder) => {
        this.dbProvider.searchQuery(builder, searchFields, tableIndex, search);
      });
    }
    this.dbProvider.calendarDailyCollectionQuery(queryBuilder, {
      startDate,
      endDate,
      startField: startField as DateFieldDto,
      endField: endField as DateFieldDto,
      dbTableName: viewCte || dbTableName,
    });
    const result = await this.prisma
      .txClient()
      .$queryRawUnsafe<
        { date: Date | string; count: number; ids: string[] | string }[]
      >(queryBuilder.toQuery());

    const countMap = result.reduce(
      (map, item) => {
        const key = isString(item.date) ? item.date : item.date.toISOString().split('T')[0];
        map[key] = Number(item.count);
        return map;
      },
      {} as Record<string, number>
    );
    let recordIds = result
      .map((item) => (isString(item.ids) ? item.ids.split(',') : item.ids))
      .flat();
    recordIds = Array.from(new Set(recordIds));

    if (!recordIds.length) {
      return {
        countMap,
        records: [],
      };
    }

    const { records } = await this.recordService.getRecordsById(tableId, recordIds);

    return {
      countMap,
      records,
    };
  }
}
