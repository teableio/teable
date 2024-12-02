/* eslint-disable sonarjs/no-duplicate-string */
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { IGridColumnMeta, IFilter, IGroup } from '@teable/core';
import {
  CellValueType,
  identify,
  IdPrefix,
  mergeWithDefaultFilter,
  nullsToUndefined,
  StatisticsFunc,
  ViewType,
} from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IAggregationField,
  IGetRecordsRo,
  IQueryBaseRo,
  IRawAggregations,
  IRawAggregationValue,
  IRawRowCountValue,
  IGroupPointsRo,
  ICalendarDailyCollectionRo,
  ICalendarDailyCollectionVo,
  ISearchIndexByQueryRo,
  ISearchCountRo,
} from '@teable/openapi';
import dayjs from 'dayjs';
import { Knex } from 'knex';
import { get, groupBy, isDate, isEmpty, isString, keyBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IClsStore } from '../../types/cls';
import { convertValueToStringify, string2Hash } from '../../utils';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
import type { DateFieldDto } from '../field/model/field-dto/date-field.dto';
import { RecordService } from '../record/record.service';

export type IWithView = {
  viewId?: string;
  groupBy?: IGroup;
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
    search?: [string, string?, boolean?];
  }): Promise<IRawAggregationValue> {
    const { tableId, withFieldIds, withView, search } = params;
    // Retrieve the current user's ID to build user-related query conditions
    const currentUserId = this.cls.get('user.id');

    const { statisticsData, fieldInstanceMap, fieldInstanceMapWithoutHiddenFields } =
      await this.fetchStatisticsParams({
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
      fieldInstanceMapWithoutHiddenFields,
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

    const aggregationsWithGroup = await this.performGroupedAggregation({
      aggregations,
      statisticFields,
      filter,
      search,
      groupBy,
      dbTableName,
      fieldInstanceMap,
      fieldInstanceMapWithoutHiddenFields,
    });

    return { aggregations: aggregationsWithGroup };
  }

  async performGroupedAggregation(params: {
    aggregations: IRawAggregations;
    statisticFields: IAggregationField[] | undefined;
    filter?: IFilter;
    search?: [string, string?, boolean?];
    groupBy?: IGroup;
    dbTableName: string;
    fieldInstanceMap: Record<string, IFieldInstance>;
    fieldInstanceMapWithoutHiddenFields: Record<string, IFieldInstance>;
  }) {
    const {
      dbTableName,
      aggregations,
      statisticFields,
      filter,
      groupBy,
      search,
      fieldInstanceMap,
      fieldInstanceMapWithoutHiddenFields,
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
        fieldInstanceMapWithoutHiddenFields,
        filter,
        groupBy: groupBy.slice(0, i + 1),
        search,
        statisticFields,
        withUserId: currentUserId,
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
          const aggKey = `${fieldId}_${statisticFunc}`;
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

  async performRowCount(tableId: string, queryRo: IQueryBaseRo): Promise<IRawRowCountValue> {
    const { filterLinkCellCandidate, filterLinkCellSelected, selectedRecordIds } = queryRo;
    // Retrieve the current user's ID to build user-related query conditions
    const currentUserId = this.cls.get('user.id');

    const { statisticsData, fieldInstanceMap, fieldInstanceMapWithoutHiddenFields } =
      await this.fetchStatisticsParams({
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
      fieldInstanceMapWithoutHiddenFields,
      filter,
      filterLinkCellCandidate,
      filterLinkCellSelected,
      selectedRecordIds,
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
    fieldInstanceMapWithoutHiddenFields: Record<string, IFieldInstance>;
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

    const fieldInstanceMapWithoutHiddenFields = { ...fieldInstanceMap };

    if (viewRaw?.columnMeta) {
      const columnMeta = JSON.parse(viewRaw?.columnMeta);
      Object.entries(columnMeta).forEach(([key, value]) => {
        if (get(value, ['hidden'])) {
          delete fieldInstanceMapWithoutHiddenFields[key];
        }
      });
    }
    return { statisticsData, fieldInstanceMap, fieldInstanceMapWithoutHiddenFields };
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
    fieldInstanceMapWithoutHiddenFields: Record<string, IFieldInstance>;
    filter?: IFilter;
    groupBy?: IGroup;
    search?: [string, string?, boolean?];
    statisticFields?: IAggregationField[];
    withUserId?: string;
  }) {
    const { dbTableName, fieldInstanceMap, filter, search, statisticFields, withUserId, groupBy } =
      params;

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
        if (search && search[2]) {
          qb.where((builder) => {
            this.dbProvider.searchQuery(builder, fieldInstanceMap, search);
          });
        }
      })
      .from(tableAlias);

    const qb = this.dbProvider
      .aggregationQuery(queryBuilder, tableAlias, fieldInstanceMap, statisticFields)
      .appendBuilder();

    if (groupBy) {
      this.dbProvider
        .groupQuery(
          qb,
          fieldInstanceMap,
          groupBy.map((item) => item.fieldId)
        )
        .appendGroupBuilder();
    }
    const aggSql = qb.toQuery();
    return this.prisma.$queryRawUnsafe<{ [field: string]: unknown }[]>(aggSql);
  }

  private async handleRowCount(params: {
    tableId: string;
    dbTableName: string;
    fieldInstanceMap: Record<string, IFieldInstance>;
    fieldInstanceMapWithoutHiddenFields: Record<string, IFieldInstance>;
    filter?: IFilter;
    filterLinkCellCandidate?: IGetRecordsRo['filterLinkCellCandidate'];
    filterLinkCellSelected?: IGetRecordsRo['filterLinkCellSelected'];
    selectedRecordIds?: IGetRecordsRo['selectedRecordIds'];
    search?: [string, string?, boolean?];
    withUserId?: string;
  }) {
    const {
      tableId,
      dbTableName,
      fieldInstanceMap,
      fieldInstanceMapWithoutHiddenFields,
      filter,
      filterLinkCellCandidate,
      filterLinkCellSelected,
      selectedRecordIds,
      search,
      withUserId,
    } = params;

    const queryBuilder = this.knex(dbTableName);

    if (filter) {
      this.dbProvider
        .filterQuery(queryBuilder, fieldInstanceMap, filter, { withUserId })
        .appendQueryBuilder();
    }

    if (search && search[2]) {
      queryBuilder.where((builder) => {
        this.dbProvider.searchQuery(builder, fieldInstanceMapWithoutHiddenFields, search);
      });
    }

    if (selectedRecordIds) {
      filterLinkCellCandidate
        ? queryBuilder.whereNotIn(`${dbTableName}.__id`, selectedRecordIds)
        : queryBuilder.whereIn(`${dbTableName}.__id`, selectedRecordIds);
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

  public async getGroupPoints(tableId: string, query?: IGroupPointsRo) {
    const { groupPoints } = await this.recordService.getGroupRelatedData(tableId, query);
    return groupPoints;
  }

  public async getSearchCount(tableId: string, queryRo: ISearchCountRo, projection?: string[]) {
    const { search, viewId } = queryRo;
    const dbFieldName = await this.getDbTableName(this.prisma, tableId);
    const { fieldInstanceMap } = await this.getFieldsData(tableId, undefined, false);

    if (!search) {
      throw new BadRequestException('Search query is required');
    }

    const searchFields = await this.recordService.getSearchFields(
      fieldInstanceMap,
      search,
      viewId,
      projection
    );

    if (searchFields?.length === 0) {
      return { count: 0 };
    }

    const queryBuilder = this.knex(dbFieldName);
    this.dbProvider.searchCountQuery(queryBuilder, searchFields, search[0]);
    this.dbProvider
      .filterQuery(queryBuilder, fieldInstanceMap, queryRo?.filter, {
        withUserId: this.cls.get('user.id'),
      })
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
    const { search, take, skip, orderBy, filter, viewId, groupBy } = queryRo;
    const dbTableName = await this.getDbTableName(this.prisma, tableId);
    const { fieldInstanceMap } = await this.getFieldsData(tableId, undefined, false);

    if (take > 1000) {
      throw new BadGatewayException('The maximum search index result is 1000');
    }

    if (!search) {
      throw new BadRequestException('Search query is required');
    }

    const searchFields = await this.recordService.getSearchFields(
      fieldInstanceMap,
      search,
      viewId,
      projection
    );

    if (searchFields.length === 0) {
      return null;
    }

    const { queryBuilder: viewRecordsQB } = await this.recordService.buildFilterSortQuery(
      tableId,
      queryRo
    );

    const basicSortIndex = await this.recordService.getBasicOrderIndexField(dbTableName, viewId);

    const queryBuilder = this.knex.queryBuilder();

    this.dbProvider.searchIndexQuery(queryBuilder, searchFields, search?.[0], dbTableName);

    if (orderBy?.length || groupBy?.length) {
      this.dbProvider
        .sortQuery(queryBuilder, fieldInstanceMap, [...(groupBy ?? []), ...(orderBy ?? [])])
        .appendSortBuilder();
    }

    if (filter) {
      this.dbProvider
        .filterQuery(queryBuilder, fieldInstanceMap, filter, {
          withUserId: this.cls.get('user.id'),
        })
        .appendQueryBuilder();
    }

    queryBuilder.orderBy(basicSortIndex, 'asc');
    const cases = searchFields.map((field, index) => {
      return this.knex.raw(`CASE WHEN ?? = ? THEN ? END`, [
        'matched_column',
        field.dbFieldName,
        index + 1,
      ]);
    });
    cases.length && queryBuilder.orderByRaw(cases.join(','));

    queryBuilder.limit(take);
    skip && queryBuilder.offset(skip);

    const sql = queryBuilder.toQuery();

    const result = await this.prisma.$queryRawUnsafe<{ __id: string; fieldId: string }[]>(sql);

    // no result found
    if (result?.length === 0) {
      return null;
    }

    const recordIds = result;

    // step 2. find the index in current view
    const indexQueryBuilder = this.knex
      .select('row_num')
      .select('__id')
      .from((qb: Knex.QueryBuilder) => {
        qb.select('__id')
          .select(this.knex.client.raw('ROW_NUMBER() OVER () as row_num'))
          .from(viewRecordsQB.as('t'))
          .as('t1');
      })
      .whereIn(
        '__id',
        recordIds.map((record) => record.__id)
      );

    // eslint-disable-next-line
    const indexResult = await this.prisma.$queryRawUnsafe<{ row_num: number; __id: string }[]>(
      indexQueryBuilder.toQuery()
    );

    if (indexResult?.length === 0) {
      return null;
    }

    const indexResultMap = keyBy(indexResult, '__id');

    return result.map((item) => {
      const index = Number(indexResultMap[item.__id]?.row_num);
      if (isNaN(index)) {
        throw new Error('Index not found');
      }
      return {
        index,
        fieldId: item.fieldId,
      };
    });
  }

  public async getCalendarDailyCollection(
    tableId: string,
    query: ICalendarDailyCollectionRo
  ): Promise<ICalendarDailyCollectionVo> {
    const { startDate, endDate, startDateFieldId, endDateFieldId, viewId, filter, search } = query;

    if (identify(tableId) !== IdPrefix.Table) {
      throw new InternalServerErrorException('query collection must be table id');
    }

    const dbTableName = await this.getDbTableName(this.prisma, tableId);
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
      throw new BadRequestException('Invalid start date field id');
    }

    const endField = endDateFieldId ? fieldMap[endDateFieldId] : startField;

    if (
      !endField ||
      endField.cellValueType !== CellValueType.DateTime ||
      endField.isMultipleCellValue
    ) {
      throw new BadRequestException('Invalid end date field id');
    }

    const queryBuilder = this.knex(dbTableName);
    const viewRaw = await this.findView(tableId, { viewId });
    const filterStr = viewRaw?.filter;
    const mergedFilter = mergeWithDefaultFilter(filterStr, filter);
    const currentUserId = this.cls.get('user.id');

    if (mergedFilter) {
      this.dbProvider
        .filterQuery(queryBuilder, fieldMap, mergedFilter, { withUserId: currentUserId })
        .appendQueryBuilder();
    }

    if (search) {
      const handledSearch = search ? this.recordService.parseSearch(search, fieldMap) : undefined;
      queryBuilder.where((builder) => {
        this.dbProvider.searchQuery(builder, fieldMap, handledSearch);
      });
    }

    this.dbProvider.calendarDailyCollectionQuery(queryBuilder, {
      startDate,
      endDate,
      startField: startField as DateFieldDto,
      endField: endField as DateFieldDto,
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
