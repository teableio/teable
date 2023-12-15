import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  IFilter,
  IGetRecordsQuery,
  IRawAggregations,
  IRawAggregationValue,
  IRawRowCountValue,
  IColumnMeta,
} from '@teable-group/core';
import {
  mergeWithDefaultFilter,
  nullsToUndefined,
  StatisticsFunc,
  ViewType,
} from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '@teable-group/db-main-prisma';
import dayjs from 'dayjs';
import { Knex } from 'knex';
import { groupBy, isEmpty } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { IDbProvider } from '../../db-provider/db.provider.interface';
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
  statisticFields?: IStatisticField[];
};

type IStatisticField = {
  field: IFieldInstance;
  statisticFunc: StatisticsFunc;
};

@Injectable()
export class AggregationService {
  private logger = new Logger(AggregationService.name);

  constructor(
    private recordService: RecordService,
    private prisma: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @Inject('DbProvider') private dbProvider: IDbProvider
  ) {}

  async performAggregation(params: {
    tableId: string;
    withFieldIds?: string[];
    withView?: IWithView;
  }): Promise<IRawAggregationValue> {
    const { tableId, withFieldIds, withView } = params;

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
      statisticFields,
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

  async performRowCount(params: {
    tableId: string;
    filterLinkCellCandidate?: IGetRecordsQuery['filterLinkCellCandidate'];
    filterLinkCellSelected?: IGetRecordsQuery['filterLinkCellSelected'];
    withView?: IWithView;
  }): Promise<IRawRowCountValue> {
    const { tableId, filterLinkCellCandidate, filterLinkCellSelected, withView } = params;

    const { statisticsData, fieldInstanceMap } = await this.fetchStatisticsParams({
      tableId,
      withView,
    });

    const dbTableName = await this.getDbTableName(this.prisma, tableId);

    const { filter } = statisticsData;

    if (filterLinkCellSelected) {
      // TODO: use a new method to retrieve only count
      const { ids } = await this.recordService.getLinkSelectedRecordIds(filterLinkCellSelected);
      return { rowCount: ids.length };
    }

    const rawRowCountData = await this.handleRowCount({
      tableId,
      dbTableName,
      fieldInstanceMap,
      filter,
      filterLinkCellCandidate,
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
          type: { in: [ViewType.Grid, ViewType.Gantt] },
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
    columnMeta?: IColumnMeta,
    customFieldStats?: ICustomFieldStats[]
  ) {
    let calculatedStatisticFields: IStatisticField[] | undefined;
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
              field: fieldInstance,
              statisticFunc: item,
            };
          });
          (calculatedStatisticFields = calculatedStatisticFields ?? []).push(...statisticFieldList);
        }
      }
    });
    return calculatedStatisticFields;
  }

  private handleAggregation(params: {
    dbTableName: string;
    fieldInstanceMap: Record<string, IFieldInstance>;
    filter?: IFilter;
    statisticFields?: IStatisticField[];
  }) {
    const { dbTableName, fieldInstanceMap, filter, statisticFields } = params;
    if (!statisticFields?.length) {
      return;
    }

    const tableAlias = 'main_table';
    const queryBuilder = this.knex
      .with(tableAlias, (qb) => {
        qb.select('*').from(dbTableName);
        if (filter) {
          this.dbProvider.filterQuery(qb, fieldInstanceMap, filter).appendQueryBuilder();
        }
      })
      .from(tableAlias);

    statisticFields.forEach(({ field, statisticFunc }) => {
      this.getAggregationFunc(queryBuilder, tableAlias, field, statisticFunc);
    });

    const aggSql = queryBuilder.toQuery();
    return this.prisma.$queryRawUnsafe<{ [field: string]: unknown }[]>(aggSql);
  }

  private async handleRowCount(params: {
    tableId: string;
    dbTableName: string;
    fieldInstanceMap: Record<string, IFieldInstance>;
    filter?: IFilter;
    filterLinkCellCandidate?: IGetRecordsQuery['filterLinkCellCandidate'];
  }) {
    const { tableId, dbTableName, fieldInstanceMap, filter, filterLinkCellCandidate } = params;

    const queryBuilder = this.knex(dbTableName);

    if (filter) {
      this.dbProvider.filterQuery(queryBuilder, fieldInstanceMap, filter).appendQueryBuilder();
    }

    if (filterLinkCellCandidate) {
      await this.recordService.buildLinkCandidateQuery(
        queryBuilder,
        tableId,
        filterLinkCellCandidate
      );
    }

    return this.getRowCount(this.prisma, queryBuilder);
  }

  private formatConvertValue = (currentValue: unknown, aggFunc?: StatisticsFunc) => {
    let convertValue =
      typeof currentValue === 'bigint' || typeof currentValue === 'number'
        ? Number(currentValue)
        : currentValue?.toString() ?? null;

    if (!aggFunc) {
      return convertValue;
    }

    if (aggFunc === StatisticsFunc.DateRangeOfMonths && currentValue) {
      const [maxTime, minTime] = (currentValue as string).split(',');

      if (!maxTime || !minTime) {
        convertValue = 0;
      } else {
        convertValue = dayjs(maxTime).diff(minTime, 'month');
      }
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

  private getAggregationFunc(
    kq: Knex.QueryBuilder,
    dbTableName: string,
    field: IFieldInstance,
    func: StatisticsFunc
  ) {
    let rawSql: string;

    const { id: fieldId, isMultipleCellValue } = field;

    const ignoreMcvFunc = [
      StatisticsFunc.Empty,
      StatisticsFunc.UnChecked,
      StatisticsFunc.Filled,
      StatisticsFunc.Checked,
      StatisticsFunc.PercentEmpty,
      StatisticsFunc.PercentUnChecked,
      StatisticsFunc.PercentFilled,
      StatisticsFunc.PercentChecked,
    ];

    if (isMultipleCellValue && !ignoreMcvFunc.includes(func)) {
      const joinTable = `${fieldId}_mcv`;

      const withRawSql = this.getDatabaseAggFunc(this.dbProvider, dbTableName, field, func);
      kq.with(`${fieldId}_mcv`, this.knex.raw(withRawSql));
      kq.joinRaw(`, ${this.knex.ref(joinTable)}`);

      rawSql = `MAX(${this.knex.ref(`${joinTable}.value`)})`;
    } else {
      rawSql = this.getDatabaseAggFunc(this.dbProvider, dbTableName, field, func);
    }

    return kq.select(this.knex.raw(`${rawSql} AS ??`, [`${fieldId}_${func}`]));
  }

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

  private getDatabaseAggFunc(
    dbProvider: IDbProvider,
    dbTableName: string,
    field: IFieldInstance,
    func: StatisticsFunc
  ): string {
    const funcName = func.toString();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (dbProvider.aggregationFunction(dbTableName, field) as any)[funcName]?.();
  }
}
