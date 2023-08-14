import { Injectable, Logger } from '@nestjs/common';
import type { IAggregations, IFilter, IViewAggregationVo } from '@teable-group/core';
import { mergeWithDefaultFilter, StatisticsFunc, ViewType } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import type { AsyncFunction } from 'async';
import async from 'async';
import type { Knex } from 'knex';
import knex from 'knex';
import { keyBy } from 'lodash';
import { PrismaService } from '../../prisma.service';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { FilterQueryTranslator } from '../record/translator/filter-query-translator';

type IWithView = {
  viewId: string;
  customFilter?: IFilter;
  customFieldStats?: ICustomFieldStats[];
};

type ICustomFieldStats = {
  fieldId: string;
  statisticFunc?: StatisticsFunc;
};

type IViewStatisticsData = {
  viewId: string;
  filter?: IFilter;
  statisticFields?: IStatisticField[];
}[];

type IStatisticField = {
  fieldId: string;
  dbFieldName: string;
  statisticFunc: StatisticsFunc;
};

type ITaskResult = {
  viewId: string;
  rawAggregationData: { [field: string]: unknown } | undefined;
  executionTime: number;
};

@Injectable()
export class AggregationService {
  private logger = new Logger(AggregationService.name);
  private readonly knex = knex({ client: 'sqlite3' });

  constructor(private prisma: PrismaService) {}

  async calculateAggregations(
    params: {
      tableId: string;
      withFieldIds?: string[];
      withView?: IWithView;
    },
    callBack?: (data?: IViewAggregationVo, error?: unknown) => Promise<void>
  ) {
    const { tableId, withFieldIds, withView } = params;

    // 1.Get view statistics data
    const { viewStatisticsData, fieldInstanceMap } = await this.getViewStatisticsData(
      tableId,
      withView,
      withFieldIds
    );

    // 2.Get database table name
    const dbTableName = await this.getDbTableName(this.prisma, tableId);

    const allTasks: AsyncFunction<ITaskResult>[] = [];
    viewStatisticsData.forEach(({ viewId, filter, statisticFields }) => {
      const aggregationTask = this.createAggregationTask(
        dbTableName,
        viewId,
        fieldInstanceMap,
        filter,
        statisticFields
      );
      if (!aggregationTask) {
        return;
      }

      const asyncFunction = (next: (err?: Error | null, data?: ITaskResult) => void) => {
        aggregationTask
          .then((taskResult) => {
            callBack &&
              callBack({
                [taskResult.viewId]: this.formatTaskResult(taskResult),
              });
            next(null, taskResult);
          })
          .catch((err) => {
            callBack && callBack(undefined, err);
            next(err);
          });
      };

      allTasks.push(asyncFunction);
    });
    const taskResults = await async.parallel<ITaskResult, ITaskResult[]>(allTasks);

    const viewAggregationResult: IViewAggregationVo = {};
    // Format task results and populate viewAggregationResult
    if (taskResults) {
      taskResults.map(this.formatTaskResult).forEach((res) => {
        if (!res) return;
        viewAggregationResult[res.viewId] = res;
      });
    }
    return viewAggregationResult;
  }

  private async getViewStatisticsData(
    tableId: string,
    withView?: IWithView,
    withFieldIds?: string[]
  ): Promise<{
    viewStatisticsData: IViewStatisticsData;
    fieldInstanceMap: Record<string, IFieldInstance>;
  }> {
    const viewRaw = await this.prisma.view.findMany({
      select: { id: true, filter: true, group: true },
      where: {
        tableId,
        ...(withView ? { id: withView.viewId } : {}),
        type: { in: [ViewType.Grid, ViewType.Gantt] },
        deletedTime: null,
      },
    });

    const viewStatisticsData: IViewStatisticsData = [];
    for (const view of viewRaw) {
      let filter;
      if (view.filter || withView?.customFilter) {
        filter = await mergeWithDefaultFilter(view.filter, withView?.customFilter);
      }

      viewStatisticsData.push({
        viewId: view.id,
        filter,
      });
    }

    const { fieldInstances, fieldInstanceMap } = await this.getFieldsData(tableId);

    const targetFieldIds =
      withView?.customFieldStats?.map((field) => field.fieldId) ?? withFieldIds;
    const filteredFieldInstances = fieldInstances.filter((instance) => {
      return !targetFieldIds?.length || targetFieldIds.includes(instance.id);
    });

    viewStatisticsData.forEach((vsd) => {
      vsd.statisticFields = this.getStatisticFields(
        vsd.viewId,
        filteredFieldInstances,
        withView?.customFieldStats
      );
    });
    return { viewStatisticsData, fieldInstanceMap };
  }

  private async getFieldsData(tableId: string) {
    const fieldsRaw = await this.prisma.field.findMany({
      where: { tableId, deletedTime: null },
    });

    const fieldInstances = fieldsRaw.map((field) => createFieldInstanceByRaw(field));
    const fieldInstanceMap = fieldInstances.reduce((map, field) => {
      map[field.id] = field;
      map[field.name] = field;
      return map;
    }, {} as Record<string, IFieldInstance>);
    return { fieldInstances, fieldInstanceMap };
  }

  private getStatisticFields(
    viewId: string,
    fieldInstances: IFieldInstance[],
    customFieldStats?: ICustomFieldStats[]
  ) {
    const statisticFields: IStatisticField[] = [];
    const customFieldStatsMap = keyBy(customFieldStats, 'fieldId');

    fieldInstances.forEach(({ id: fieldId, dbFieldName, columnMeta }) => {
      const viewFieldMeta = columnMeta[viewId];

      if (viewFieldMeta || customFieldStatsMap) {
        const { hidden, statisticFunc } = viewFieldMeta;
        const func = customFieldStatsMap[fieldId]?.statisticFunc ?? statisticFunc;

        if (hidden !== true && func) {
          statisticFields.push({
            fieldId,
            dbFieldName,
            statisticFunc: func,
          });
        }
      }
    });
    return statisticFields;
  }

  private createAggregationTask(
    dbTableName: string,
    viewId: string,
    fieldInstanceMap: Record<string, IFieldInstance>,
    filter?: IFilter,
    statisticFields?: IStatisticField[]
  ) {
    const queryBuilder = this.knex(dbTableName);

    if (!statisticFields?.length) {
      return undefined;
    }

    // Function to get aggregation data
    const getAggregationData = async (
      prisma: Prisma.TransactionClient,
      queryBuilder: Knex.QueryBuilder
    ) => {
      if (filter) {
        new FilterQueryTranslator(queryBuilder, fieldInstanceMap, filter).translateToSql();
      }

      // Get Aggregation functions for each field
      statisticFields.forEach(({ fieldId, dbFieldName, statisticFunc }) => {
        this.getAggregationFn(queryBuilder, fieldId, dbFieldName, statisticFunc);
      });

      const sqlNative = queryBuilder.toSQL().toNative();
      return prisma.$queryRawUnsafe<{ [field: string]: unknown }[]>(
        sqlNative.sql,
        ...sqlNative.bindings
      );
    };

    // Return promise that resolves to task result
    return new Promise<ITaskResult>((resolve, reject) => {
      getAggregationData(this.prisma, queryBuilder)
        .then((rawAggregationData) => {
          resolve({
            viewId,
            rawAggregationData: rawAggregationData && rawAggregationData[0],
            executionTime: new Date().getTime(),
          });
        })
        .catch(reject);
    });
  }

  private formatTaskResult(taskResult: ITaskResult) {
    const aggregations: IAggregations = {};
    for (const [key, value] of Object.entries(taskResult.rawAggregationData || {})) {
      const [fieldId, aggFunc] = key.split('_');
      const convertValue =
        typeof value === 'bigint' || typeof value === 'number' ? Number(value) : String(value);

      aggregations[fieldId] = {
        total: {
          value: convertValue,
          aggFunc: aggFunc as StatisticsFunc,
        },
      };
    }

    return {
      viewId: taskResult.viewId,
      executionTime: taskResult.executionTime,
      aggregations,
    };
  }

  private getAggregationFn(
    kq: Knex.QueryBuilder,
    fieldId: string,
    dbFieldName: string,
    func: StatisticsFunc
  ) {
    let rawSql: string;
    switch (func) {
      case StatisticsFunc.Empty:
      case StatisticsFunc.UnChecked:
        // rawSql = `sum(case when ${dbFieldName} is null then 1 else 0 end)`;
        rawSql = `count(*) - count(${dbFieldName})`;
        break;
      case StatisticsFunc.Filled:
      case StatisticsFunc.Checked:
        rawSql = `count(${dbFieldName})`;
        break;
      case StatisticsFunc.Unique:
        rawSql = `count(distinct ${dbFieldName})`;
        break;
      case StatisticsFunc.Max:
      case StatisticsFunc.LatestDate:
        rawSql = `max(${dbFieldName})`;
        break;
      case StatisticsFunc.Min:
      case StatisticsFunc.EarliestDate:
        rawSql = `min(${dbFieldName})`;
        break;
      case StatisticsFunc.Sum:
        rawSql = `sum(${dbFieldName})`;
        break;
      case StatisticsFunc.Average:
        rawSql = `avg(${dbFieldName})`;
        break;
      case StatisticsFunc.PercentEmpty:
      case StatisticsFunc.PercentUnChecked:
        rawSql = `((count(*) - count(${dbFieldName})) * 1.0 / count(*)) * 100`;
        break;
      case StatisticsFunc.PercentFilled:
      case StatisticsFunc.PercentChecked:
        rawSql = `(count(${dbFieldName}) * 1.0 / COUNT(*)) * 100`;
        break;
      case StatisticsFunc.PercentUnique:
        rawSql = `(count(distinct ${dbFieldName}) * 1.0 / count(*)) * 100`;
        break;
      case StatisticsFunc.DateRangeOfDays:
        rawSql = `floor(julianday(max(${dbFieldName})) - julianday(min(${dbFieldName})))`;
        break;
      case StatisticsFunc.DateRangeOfMonths:
        // 使用别的方式
        break;
    }

    return kq.select(this.knex.raw(`${rawSql!} as ${fieldId}_${func}`));
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
    const sqlNative = queryBuilder.count({ count: '*' }).toSQL().toNative();

    return prisma.$queryRawUnsafe<{ count?: number }[]>(sqlNative.sql, ...sqlNative.bindings);
  }
}
