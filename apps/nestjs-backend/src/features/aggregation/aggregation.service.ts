import { Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import type { IGridColumnMeta, IFilter } from '@teable/core';
import {
  mergeWithDefaultFilter,
  nullsToUndefined,
  parseGroup,
  StatisticsFunc,
  ViewType,
} from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { GroupPointType } from '@teable/openapi';
import type {
  IAggregationField,
  IGetRecordsRo,
  IQueryBaseRo,
  IRawAggregations,
  IRawAggregationValue,
  IRawRowCountValue,
  IGroupPoint,
  IGroupPointsRo,
} from '@teable/openapi';
import dayjs from 'dayjs';
import { Knex } from 'knex';
import { groupBy, isDate, isEmpty } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IClsStore } from '../../types/cls';
import { string2Hash } from '../../utils';
import { Timing } from '../../utils/timing';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { RecordService } from '../record/record.service';

export type IWithView = {
  viewId?: string;
  customFilter?: IFilter;
  customFieldStats?: ICustomFieldStats[];
};

type ICustomFieldStats = {
  fieldId: string;
  statisticFunc?: StatisticsFunc;
};

type IStatisticsData = {
  viewId?: string;
  filter?: IFilter;
  statisticFields?: IAggregationField[];
};

@Injectable()
export class AggregationService {
  private logger = new Logger(AggregationService.name);

  constructor(
    private readonly recordService: RecordService,
    private readonly prisma: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    private readonly cls: ClsService<IClsStore>,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  async performAggregation(params: {
    tableId: string;
    withFieldIds?: string[];
    withView?: IWithView;
    search?: [string, string];
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

    const rawAggregationData = await this.handleAggregation({
      dbTableName,
      fieldInstanceMap,
      filter,
      search,
      statisticFields,
      withUserId: currentUserId,
    });

    const aggregationResult = rawAggregationData && rawAggregationData[0];

    const aggregations: IRawAggregations = [];
    if (aggregationResult) {
      for (const [key, value] of Object.entries(aggregationResult)) {
        const [fieldId, aggFunc] = key.split('_') as [string, StatisticsFunc | undefined];

        const convertValue = this.formatConvertValue(value, aggFunc);

        if (fieldId) {
          aggregations.push({
            fieldId,
            total: aggFunc ? { value: convertValue, aggFunc: aggFunc } : null,
          });
        }
      }
    }
    return { aggregations };
  }

  async performRowCount(tableId: string, queryRo: IQueryBaseRo): Promise<IRawRowCountValue> {
    const { filterLinkCellCandidate, filterLinkCellSelected } = queryRo;
    // Retrieve the current user's ID to build user-related query conditions
    const currentUserId = this.cls.get('user.id');

    const { statisticsData, fieldInstanceMap } = await this.fetchStatisticsParams({
      tableId,
      withView: {
        viewId: queryRo.viewId,
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
      search: queryRo.search,
      withUserId: currentUserId,
    });

    return {
      rowCount: Number(rawRowCountData[0]?.count ?? 0),
    };
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
        select: { id: true, columnMeta: true, filter: true, group: true },
        where: {
          tableId,
          ...(withView?.viewId ? { id: withView.viewId } : {}),
          type: { in: [ViewType.Grid, ViewType.Gantt, ViewType.Kanban] },
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

  async getFieldsData(tableId: string, fieldIds?: string[]) {
    const fieldsRaw = await this.prisma.field.findMany({
      where: { tableId, ...(fieldIds ? { id: { in: fieldIds } } : {}), deletedTime: null },
    });

    const fieldInstances = fieldsRaw.map((field) => createFieldInstanceByRaw(field));
    const fieldInstanceMap = fieldInstances.reduce(
      (map, field) => {
        map[field.id] = field;
        map[field.name] = field;
        return map;
      },
      {} as Record<string, IFieldInstance>
    );
    return { fieldInstances, fieldInstanceMap };
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
            };
          });
          (calculatedStatisticFields = calculatedStatisticFields ?? []).push(...statisticFieldList);
        }
      }
    });
    return calculatedStatisticFields;
  }

  private async handleAggregation(params: {
    dbTableName: string;
    fieldInstanceMap: Record<string, IFieldInstance>;
    filter?: IFilter;
    search?: [string, string];
    statisticFields?: IAggregationField[];
    withUserId?: string;
  }) {
    const { dbTableName, fieldInstanceMap, filter, search, statisticFields, withUserId } = params;
    if (!statisticFields?.length) {
      return;
    }

    const tableAlias = 'main_table';
    const queryBuilder = this.knex
      .with(tableAlias, (qb) => {
        qb.select('*').from(dbTableName);
        if (filter) {
          this.dbProvider
            .filterQuery(qb, fieldInstanceMap, filter, { withUserId })
            .appendQueryBuilder();
        }
        if (search) {
          this.dbProvider.searchQuery(qb, fieldInstanceMap, search);
        }
      })
      .from(tableAlias);

    const aggSql = this.dbProvider
      .aggregationQuery(queryBuilder, tableAlias, fieldInstanceMap, statisticFields)
      .appendBuilder()
      .toQuery();
    return this.prisma.$queryRawUnsafe<{ [field: string]: unknown }[]>(aggSql);
  }

  private async handleRowCount(params: {
    tableId: string;
    dbTableName: string;
    fieldInstanceMap: Record<string, IFieldInstance>;
    filter?: IFilter;
    filterLinkCellCandidate?: IGetRecordsRo['filterLinkCellCandidate'];
    filterLinkCellSelected?: IGetRecordsRo['filterLinkCellSelected'];
    search?: [string, string];
    withUserId?: string;
  }) {
    const {
      tableId,
      dbTableName,
      fieldInstanceMap,
      filter,
      filterLinkCellCandidate,
      filterLinkCellSelected,
      search,
      withUserId,
    } = params;

    const queryBuilder = this.knex(dbTableName);

    if (filter) {
      this.dbProvider
        .filterQuery(queryBuilder, fieldInstanceMap, filter, { withUserId })
        .appendQueryBuilder();
    }

    if (search) {
      this.dbProvider.searchQuery(queryBuilder, fieldInstanceMap, search);
    }

    if (filterLinkCellCandidate) {
      await this.recordService.buildLinkCandidateQuery(
        queryBuilder,
        tableId,
        dbTableName,
        filterLinkCellCandidate
      );
    }

    if (filterLinkCellSelected) {
      await this.recordService.buildLinkSelectedQuery(
        queryBuilder,
        tableId,
        dbTableName,
        filterLinkCellSelected
      );
    }

    return this.getRowCount(this.prisma, queryBuilder);
  }

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

  private async getDbTableName(prisma: Prisma.TransactionClient, tableId: string) {
    const tableMeta = await prisma.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    return tableMeta.dbTableName;
  }

  private async getRowCount(prisma: Prisma.TransactionClient, queryBuilder: Knex.QueryBuilder) {
    queryBuilder
      .clearSelect()
      .clearCounters()
      .clearGroup()
      .clearHaving()
      .clearOrder()
      .clear('limit')
      .clear('offset');
    const rowCountSql = queryBuilder.count({ count: '*' });

    return prisma.$queryRawUnsafe<{ count?: number }[]>(rowCountSql.toQuery());
  }

  private convertValueToStringify(value: unknown): number | string | null {
    if (typeof value === 'bigint' || typeof value === 'number') {
      return Number(value);
    }
    if (isDate(value)) {
      return value.toISOString();
    }
    if (typeof value === 'string') {
      return value;
    }
    if (value == null) return null;
    return JSON.stringify(value);
  }

  @Timing()
  private groupDbCollection2GroupPoints(
    groupResult: { [key: string]: unknown; __c: number }[],
    groupFields: IFieldInstance[]
  ) {
    const groupPoints: IGroupPoint[] = [];
    let fieldValues: unknown[] = [Symbol(), Symbol(), Symbol()];

    groupResult.forEach((item) => {
      const { __c: count } = item;

      groupFields.forEach((field, index) => {
        const { id, dbFieldName } = field;
        const fieldValue = this.convertValueToStringify(item[dbFieldName]);

        if (fieldValues[index] === fieldValue) return;

        fieldValues[index] = fieldValue;
        fieldValues = fieldValues.map((value, idx) => (idx > index ? Symbol() : value));

        const flagString = `${id}_${fieldValues.slice(0, index + 1).join('_')}`;

        groupPoints.push({
          id: String(string2Hash(flagString)),
          type: GroupPointType.Header,
          depth: index,
          value: field.convertDBValue2CellValue(fieldValue),
        });
      });

      groupPoints.push({ type: GroupPointType.Row, count: Number(count) });
    });
    return groupPoints;
  }

  public async getGroupPoints(tableId: string, query?: IGroupPointsRo) {
    const { viewId, groupBy: extraGroupBy, filter, search } = query || {};

    const groupBy = parseGroup(extraGroupBy);

    if (!groupBy?.length) return null;

    const viewRaw = await this.findView(tableId, { viewId });
    const { fieldInstanceMap } = await this.getFieldsData(tableId);
    const dbTableName = await this.getDbTableName(this.prisma, tableId);

    const filterStr = viewRaw?.filter;
    const mergedFilter = mergeWithDefaultFilter(filterStr, filter);
    const groupFieldIds = groupBy.map((item) => item.fieldId);

    const queryBuilder = this.knex(dbTableName);
    const distinctQueryBuilder = this.knex(dbTableName);

    if (mergedFilter) {
      const withUserId = this.cls.get('user.id');
      this.dbProvider
        .filterQuery(queryBuilder, fieldInstanceMap, mergedFilter, { withUserId })
        .appendQueryBuilder();
      this.dbProvider
        .filterQuery(distinctQueryBuilder, fieldInstanceMap, mergedFilter, { withUserId })
        .appendQueryBuilder();
    }

    if (search) {
      this.dbProvider.searchQuery(queryBuilder, fieldInstanceMap, search);
      this.dbProvider.searchQuery(distinctQueryBuilder, fieldInstanceMap, search);
    }

    this.dbProvider
      .groupQuery(distinctQueryBuilder, fieldInstanceMap, groupFieldIds, { isDistinct: true })
      .appendGroupBuilder();
    const distinctResult = await this.prisma.$queryRawUnsafe<{ count: number }[]>(
      distinctQueryBuilder.toQuery()
    );
    const distinctCount = Number(distinctResult[0].count);

    if (distinctCount > this.thresholdConfig.maxGroupPoints) {
      throw new PayloadTooLargeException(
        'Grouping results exceed limit, please adjust grouping conditions to reduce the number of groups.'
      );
    }

    this.dbProvider.sortQuery(queryBuilder, fieldInstanceMap, groupBy).appendSortBuilder();
    this.dbProvider.groupQuery(queryBuilder, fieldInstanceMap, groupFieldIds).appendGroupBuilder();

    queryBuilder.count({ __c: '*' });

    const groupSql = queryBuilder.toQuery();

    const result =
      await this.prisma.$queryRawUnsafe<{ [key: string]: unknown; __c: number }[]>(groupSql);

    const groupFields = groupFieldIds.map((fieldId) => fieldInstanceMap[fieldId]);

    return this.groupDbCollection2GroupPoints(result, groupFields);
  }
}
