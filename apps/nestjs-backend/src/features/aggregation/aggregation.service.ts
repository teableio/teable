/* eslint-disable sonarjs/no-duplicate-string */
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import type { IGridColumnMeta, IFilter, IGroup } from '@teable/core';
import {
  CellValueType,
  HttpErrorCode,
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
import { groupBy, isDate, isEmpty, isString, keyBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IClsStore } from '../../types/cls';
import { convertValueToStringify, string2Hash } from '../../utils';
import { DataLoaderService } from '../data-loader/data-loader.service';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
import type { DateFieldDto } from '../field/model/field-dto/date-field.dto';
import { RecordPermissionService } from '../record/record-permission.service';
import { RecordService } from '../record/record.service';
import { TableIndexService } from '../table/table-index.service';

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
  constructor(
    private readonly recordService: RecordService,
    private readonly tableIndexService: TableIndexService,
    private readonly prisma: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    private readonly cls: ClsService<IClsStore>,
    private readonly recordPermissionService: RecordPermissionService,
    private readonly dataLoaderService: DataLoaderService
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

  async getFieldsData(tableId: string, fieldIds?: string[], withName?: boolean) {
    const fieldsRaw = await this.dataLoaderService.field.load(
      tableId,
      fieldIds ? { id: fieldIds } : undefined
    );

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

    const tableAlias = 'main_table';
    const { viewCte, builder } = await this.recordPermissionService.wrapView(
      tableId,
      this.knex.queryBuilder(),
      {
        viewId,
      }
    );

    const queryBuilder = builder
      .with(tableAlias, (qb) => {
        const viewQueryDbTableName = viewCte ?? dbTableName;
        qb.select('*').from(viewQueryDbTableName);
        if (filter) {
          this.dbProvider
            .filterQuery(qb, fieldInstanceMap, filter, { withUserId })
            .appendQueryBuilder();
        }
        if (search && search[2]) {
          qb.where((builder) => {
            this.dbProvider.searchQuery(
              builder,
              viewQueryDbTableName,
              searchFields,
              tableIndex,
              search
            );
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
    const viewQueryDbTableName = viewCte ?? dbTableName;
    queryBuilder.from(viewQueryDbTableName);

    if (filter) {
      this.dbProvider
        .filterQuery(queryBuilder, fieldInstanceMap, filter, { withUserId })
        .appendQueryBuilder();
    }

    if (search && search[2]) {
      const searchFields = await this.recordService.getSearchFields(
        fieldInstanceMap,
        search,
        viewId
      );
      const tableIndex = await this.tableIndexService.getActivatedTableIndexes(tableId);
      queryBuilder.where((builder) => {
        this.dbProvider.searchQuery(
          builder,
          viewQueryDbTableName,
          searchFields,
          tableIndex,
          search
        );
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
        filterLinkCellCandidate
      );
    }

    if (filterLinkCellSelected) {
      await this.recordService.buildLinkSelectedQuery(
        queryBuilder,
        tableId,
        viewQueryDbTableName,
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
    const { search, viewId, ignoreViewQuery } = queryRo;
    const dbFieldName = await this.getDbTableName(this.prisma, tableId);
    const { fieldInstanceMap } = await this.getFieldsData(tableId, undefined, false);

    if (!search) {
      throw new BadRequestException('Search query is required');
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
    this.dbProvider.searchCountQuery(queryBuilder, dbFieldName, searchFields, search, tableIndex);
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
      throw new BadGatewayException('The maximum search index result is 1000');
    }

    if (!search) {
      throw new BadRequestException('Search query is required');
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

    const basicSortIndex = await this.recordService.getBasicOrderIndexField(dbTableName, viewId);

    const filterQuery = (qb: Knex.QueryBuilder) => {
      this.dbProvider
        .filterQuery(qb, fieldInstanceMap, filter, {
          withUserId: this.cls.get('user.id'),
        })
        .appendQueryBuilder();
    };

    const sortQuery = (qb: Knex.QueryBuilder) => {
      this.dbProvider
        .sortQuery(qb, fieldInstanceMap, [...(groupBy ?? []), ...(orderBy ?? [])])
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
      basicSortIndex,
      filterQuery,
      sortQuery
    );

    const sql = queryBuilder.toQuery();
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

        const { queryBuilder: viewRecordsQB } = await this.recordService.buildFilterSortQuery(
          tableId,
          queryRo
        );
        // step 2. find the index in current view
        const indexQueryBuilder = this.knex
          .with('t', viewRecordsQB.select('__id').from(viewCte || dbTableName))
          .with('t1', (db) => {
            db.select('__id').select(this.knex.raw('ROW_NUMBER() OVER () as row_num')).from('t');
          })
          .select('t1.row_num')
          .select('t1.__id')
          .from('t1')
          .whereIn('t1.__id', [...new Set(recordIds.map((record) => record.__id))]);
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
            recordId: item.__id,
          };
        });
      });
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2028') {
        throw new CustomHttpException(`${error.message}`, HttpErrorCode.REQUEST_TIMEOUT, {
          localization: {
            i18nKey: 'httpErrors.custom.searchTimeOut',
          },
        });
      }
      throw error;
    }
  }

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
      throw new InternalServerErrorException('query collection must be table id');
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

    const viewId = ignoreViewQuery ? undefined : query.viewId;
    const dbTableName = await this.getDbTableName(this.prisma, tableId);
    const { viewCte, builder: queryBuilder } = await this.recordPermissionService.wrapView(
      tableId,
      this.knex.queryBuilder(),
      {
        viewId,
      }
    );
    const viewQueryDbTableName = viewCte ?? dbTableName;
    queryBuilder.from(viewQueryDbTableName);
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
      const searchFields = await this.recordService.getSearchFields(
        fieldMap,
        search,
        query?.viewId
      );
      const tableIndex = await this.tableIndexService.getActivatedTableIndexes(tableId);
      queryBuilder.where((builder) => {
        this.dbProvider.searchQuery(
          builder,
          viewQueryDbTableName,
          searchFields,
          tableIndex,
          search
        );
      });
    }
    this.dbProvider.calendarDailyCollectionQuery(queryBuilder, {
      startDate,
      endDate,
      startField: startField as DateFieldDto,
      endField: endField as DateFieldDto,
      dbTableName: viewQueryDbTableName,
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
