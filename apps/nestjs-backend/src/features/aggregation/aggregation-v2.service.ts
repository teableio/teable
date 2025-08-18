import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { mergeWithDefaultFilter, nullsToUndefined, ViewType } from '@teable/core';
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
} from '@teable/openapi';
import dayjs from 'dayjs';
import { Knex } from 'knex';
import { groupBy, isDate, isEmpty, keyBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IClsStore } from '../../types/cls';
import { convertValueToStringify, string2Hash } from '../../utils';
import { createFieldInstanceByRaw, type IFieldInstance } from '../field/model/factory';
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
export class AggregationServiceV2 implements IAggregationService {
  private logger = new Logger(AggregationServiceV2.name);
  constructor(
    private readonly recordService: RecordService,
    private readonly tableIndexService: TableIndexService,
    private readonly prisma: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
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
  }): Promise<IRawAggregationValue> {
    const { tableId, withFieldIds, withView, search } = params;
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
    });

    const aggregationResult = rawAggregationData && rawAggregationData[0];

    const aggregations: IRawAggregations = [];
    if (aggregationResult) {
      for (const [key, value] of Object.entries(aggregationResult)) {
        const statisticField = statisticFields?.find((item) => item.fieldId === key);
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
    } = params;

    if (!statisticFields?.length) {
      return;
    }

    const { viewId } = withView || {};

    const searchFields = await this.recordService.getSearchFields(fieldInstanceMap, search, viewId);
    const tableIndex = await this.tableIndexService.getActivatedTableIndexes(tableId);

    const { viewCte, builder } = await this.recordPermissionService.wrapView(
      tableId,
      this.knex.queryBuilder(),
      {
        viewId,
      }
    );

    const { qb } = await this.recordQueryBuilder.createRecordAggregateBuilder(
      viewCte ?? dbTableName,
      {
        tableIdOrDbTableName: tableId,
        viewId,
        filter,
        aggregationFields: statisticFields,
        groupBy: groupBy?.map((item) => item.fieldId),
        currentUserId: withUserId,
      }
    );

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
          const { fieldId, statisticFunc } = statisticField;
          const aggKey = fieldId;
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
    const { viewCte, builder: queryBuilder } = await this.recordPermissionService.wrapView(
      tableId,
      this.knex.queryBuilder(),
      {
        keepPrimaryKey: Boolean(filterLinkCellSelected),
        viewId,
      }
    );

    const { qb } = await this.recordQueryBuilder.createRecordAggregateBuilder(
      viewCte ?? dbTableName,
      {
        tableIdOrDbTableName: tableId,
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
        this.dbProvider.searchQuery(builder, searchFields, tableIndex, search);
      });
    }

    if (selectedRecordIds) {
      filterLinkCellCandidate
        ? qb.whereNotIn(`${dbTableName}.__id`, selectedRecordIds)
        : qb.whereIn(`${dbTableName}.__id`, selectedRecordIds);
    }

    if (filterLinkCellCandidate) {
      await this.recordService.buildLinkCandidateQuery(qb, tableId, filterLinkCellCandidate);
    }

    if (filterLinkCellSelected) {
      await this.recordService.buildLinkSelectedQuery(
        qb,
        tableId,
        dbTableName,
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
            in: [
              ViewType.Grid,
              ViewType.Gantt,
              ViewType.Kanban,
              ViewType.Gallery,
              ViewType.Calendar,
            ],
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
              alias: fieldId,
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
  async getGroupPoints(tableId: string, query?: IGroupPointsRo): Promise<IGroupPoint[]> {
    throw new NotImplementedException(
      `AggregationServiceV2.getGroupPoints is not implemented yet. TableId: ${tableId}, Query: ${JSON.stringify(query)}`
    );
  }

  /**
   * Get search count for a table
   * @param tableId - The table ID
   * @param queryRo - Search query parameters
   * @param projection - Optional field projection
   * @returns Promise with search count result
   * @throws NotImplementedException - This method is not yet implemented
   */
  async getSearchCount(
    tableId: string,
    queryRo: ISearchCountRo,
    projection?: string[]
  ): Promise<{ count: number }> {
    throw new NotImplementedException(
      `AggregationServiceV2.getSearchCount is not implemented yet. TableId: ${tableId}, Query: ${JSON.stringify(queryRo)}, Projection: ${projection?.join(',')}`
    );
  }

  /**
   * Get record index by search order
   * @param tableId - The table ID
   * @param queryRo - Search index query parameters
   * @param projection - Optional field projection
   * @returns Promise with search index results
   * @throws NotImplementedException - This method is not yet implemented
   */
  async getRecordIndexBySearchOrder(
    tableId: string,
    queryRo: ISearchIndexByQueryRo,
    projection?: string[]
  ): Promise<
    | {
        index: number;
        fieldId: string;
        recordId: string;
      }[]
    | null
  > {
    throw new NotImplementedException(
      `AggregationServiceV2.getRecordIndexBySearchOrder is not implemented yet. TableId: ${tableId}, Query: ${JSON.stringify(queryRo)}, Projection: ${projection?.join(',')}`
    );
  }

  /**
   * Get calendar daily collection data
   * @param tableId - The table ID
   * @param query - Calendar collection query parameters
   * @returns Promise<ICalendarDailyCollectionVo> - The calendar collection data
   * @throws NotImplementedException - This method is not yet implemented
   */
  async getCalendarDailyCollection(
    tableId: string,
    query: ICalendarDailyCollectionRo
  ): Promise<ICalendarDailyCollectionVo> {
    throw new NotImplementedException(
      `AggregationServiceV2.getCalendarDailyCollection is not implemented yet. TableId: ${tableId}, Query: ${JSON.stringify(query)}`
    );
  }
}
