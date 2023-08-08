import { Injectable, Logger } from '@nestjs/common';
import type { IAggregates, IFilter, IViewAggregateVo } from '@teable-group/core';
import { mergeWithDefaultFilter, StatisticsFunc, ViewType } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import async from 'async';
import type { Knex } from 'knex';
import knex from 'knex';
import { findLast, keyBy, pickBy, tail } from 'lodash';
import { PrismaService } from '../../prisma.service';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { FilterQueryTranslator } from '../record/translator/filter-query-translator';

type IWithView = {
  viewId: string;
  customFilter?: IFilter;
};

type ICustomFieldStats = {
  fieldId: string;
  statisticFunc?: StatisticsFunc;
};

type IViewsResult = {
  withoutFilter: {
    viewId: string;
  }[];
  withFilter: {
    viewId: string;
    filter: IFilter;
  }[];
};

type IStatsFields = {
  [fieldId: string]: {
    dbFieldName: string;
    statisticFunc: StatisticsFunc;
  };
};

type ITaskResult = {
  viewId: string;
  rawCount: number;
  rawAggregateData: { [field: string]: unknown } | undefined;
  executionTime: number;
};

@Injectable()
export class AggregateService {
  private logger = new Logger(AggregateService.name);
  private readonly knex = knex({ client: 'sqlite3' });

  constructor(private prisma: PrismaService) {}

  async calculateAggregates(
    params: {
      tableId: string;
      withFieldIds?: string[];
      withView?: IWithView & { customFieldStats?: ICustomFieldStats[] };
    },
    callBack?: (data?: IViewAggregateVo, error?: unknown) => Promise<void>
  ) {
    const { tableId, withFieldIds, withView } = params;

    // 1.Get views data
    const views = await this.getViewsData(tableId, withView);

    // 2.Get field instances and field instance map
    const fieldIds = withView?.customFieldStats?.map((field) => field.fieldId) ?? withFieldIds;
    const { fieldInstances, fieldInstanceMap } = await this.getFieldsData(tableId, fieldIds);

    // 3.Get database table name
    const dbTableName = await this.getDbTableName(this.prisma, tableId);

    /*
     * Aggregate without filter for first view
     *
     * The same data is aggregated once with the fullest data condition,
     * and if there is more than 1 piece of data, it will be returned as repaired data at the end.
     */
    const aggregateWithoutFilter =
      views.withoutFilter[0] &&
      this.createAggregationTask(
        fieldInstances,
        fieldInstanceMap,
        dbTableName,
        views.withoutFilter[0].viewId,
        withView?.customFieldStats
      );

    // Aggregate with filter for each view
    const aggregateWithFilter = views.withFilter.map(({ viewId, filter }) =>
      this.createAggregationTask(
        fieldInstances,
        fieldInstanceMap,
        dbTableName,
        viewId,
        withView?.customFieldStats,
        filter
      )
    );

    const allTasks = [aggregateWithoutFilter, ...aggregateWithFilter].filter(Boolean);

    const map = allTasks.map(
      (value) => (next: (err?: Error | null, data?: ITaskResult) => void) => {
        value
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
      }
    );

    const taskResults = await async.parallel<ITaskResult, ITaskResult[]>(map);

    // const taskResults = await Promise.all(allTasks);

    const viewAggregateResult: IViewAggregateVo = {};
    // Format task results and populate viewAggregateResult
    if (taskResults) {
      taskResults.map(this.formatTaskResult).forEach((res) => {
        if (!res) return;
        viewAggregateResult[res.viewId] = res;
      });
      // Fix aggregate without filter
      this.fixWithoutFilterAggregate(viewAggregateResult, views, fieldInstanceMap);
    }
    return viewAggregateResult;
  }

  private async getViewsData(tableId: string, withView?: IWithView): Promise<IViewsResult> {
    const viewRaw = await this.prisma.view.findMany({
      select: { id: true, filter: true, group: true },
      where: {
        tableId,
        ...(withView ? { id: withView.viewId } : {}),
        type: { in: [ViewType.Grid, ViewType.Gantt] },
        deletedTime: null,
      },
    });

    const viewsResult: IViewsResult = {
      withoutFilter: [],
      withFilter: [],
    };
    for (const view of viewRaw) {
      if (view.filter || withView?.customFilter) {
        viewsResult.withFilter.push({
          viewId: view.id,
          filter: (await mergeWithDefaultFilter(view.filter, withView?.customFilter))!,
        });
      } else {
        viewsResult.withoutFilter.push({ viewId: view.id });
      }
    }
    return viewsResult;
  }

  private async getFieldsData(tableId: string, fieldIds?: string[]) {
    const fieldsRaw = await this.prisma.field.findMany({
      where: { ...(fieldIds ? { id: { in: fieldIds } } : {}), tableId, deletedTime: null },
    });

    const fieldInstances = fieldsRaw.map((field) => createFieldInstanceByRaw(field));
    const fieldInstanceMap = fieldInstances.reduce((map, field) => {
      map[field.id] = field;
      map[field.name] = field;
      return map;
    }, {} as Record<string, IFieldInstance>);
    return { fieldInstances, fieldInstanceMap };
  }

  private getStatsFields(
    fields: IFieldInstance[],
    viewId: string,
    customFieldStats?: ICustomFieldStats[],
    withHidden?: boolean
  ) {
    const statsFields: IStatsFields = {};

    const customFieldStatsMap = keyBy(customFieldStats, 'fieldId');

    fields.forEach(({ id, dbFieldName, columnMeta }) => {
      const viewFieldMeta = columnMeta[viewId];

      if (viewFieldMeta || customFieldStatsMap) {
        const { hidden, statisticFunc } = viewFieldMeta;
        const func = customFieldStatsMap[id]?.statisticFunc ?? statisticFunc;

        if ((hidden !== true || withHidden) && func) {
          statsFields[id] = {
            dbFieldName,
            statisticFunc: func,
          };
        }
      }
    });
    return statsFields;
  }

  private createAggregationTask(
    fieldInstances: IFieldInstance[],
    fieldInstanceMap: Record<string, IFieldInstance>,
    dbTableName: string,
    viewId: string,
    customFieldStats?: ICustomFieldStats[],
    filter?: IFilter
  ) {
    const queryBuilder = this.knex(dbTableName);

    // Get fields for stats
    const statsFields = this.getStatsFields(
      fieldInstances,
      viewId,
      customFieldStats,
      filter === undefined
    );

    // Function to get aggregate data
    const getAggregateData = async (
      prisma: Prisma.TransactionClient,
      queryBuilder: Knex.QueryBuilder
    ) => {
      if (!Object.keys(statsFields).length) {
        return undefined;
      }

      if (filter) {
        new FilterQueryTranslator(queryBuilder, fieldInstanceMap, filter).translateToSql();
      }

      // Get aggregate functions for each field
      for (const [fieldId, statsField] of Object.entries(statsFields)) {
        this.getAggregateFn(
          queryBuilder,
          fieldId,
          statsField.dbFieldName,
          statsField.statisticFunc
        );
      }

      const sqlNative = queryBuilder.toSQL().toNative();
      return prisma.$queryRawUnsafe<{ [field: string]: unknown }[]>(
        sqlNative.sql,
        ...sqlNative.bindings
      );
    };

    // Return promise that resolves to task result
    return new Promise<ITaskResult>((resolve, reject) => {
      this.prisma
        .$transaction(async (tx) => {
          return [
            await getAggregateData(tx, queryBuilder),
            await this.getRowCount(tx, queryBuilder),
          ];
        })
        .then(([rawAggregateData, rawCount]) => {
          resolve({
            viewId,
            rawAggregateData: rawAggregateData && rawAggregateData[0],
            rawCount: Number((rawCount && rawCount[0]?.count) ?? 0),
            executionTime: new Date().getTime(),
          });
        })
        .catch(reject);
    });
  }

  private formatTaskResult(taskResult: ITaskResult) {
    const aggregates: IAggregates = {};
    for (const [key, value] of Object.entries(taskResult.rawAggregateData || {})) {
      const [fieldId, funcName] = key.split('_');
      aggregates[fieldId] = {
        fieldId,
        value: String(value),
        funcName,
      };
    }

    return {
      viewId: taskResult.viewId,
      rowCount: taskResult.rawCount,
      executionTime: taskResult.executionTime,
      aggregates,
    };
  }

  private fixWithoutFilterAggregate(
    viewAggregateResult: IViewAggregateVo,
    views: IViewsResult,
    fieldInstanceMap: Record<string, IFieldInstance>
  ) {
    if (views.withoutFilter.length < 1) {
      return;
    }

    // Get aggregate result from the first unfiltered view
    const withoutFilterStats = findLast(
      viewAggregateResult,
      (r) => r.viewId === views.withoutFilter[0].viewId
    );

    withoutFilterStats &&
      tail(views.withoutFilter).forEach(({ viewId }) => {
        // Copy aggregates, excluding hidden fields without statisticFunc
        const aggregates = pickBy(withoutFilterStats.aggregates, (value) => {
          const columnMeta = fieldInstanceMap[value.fieldId]?.columnMeta[viewId];
          return !columnMeta?.hidden && columnMeta?.statisticFunc;
        });

        // Copy row count to each remaining unfiltered view
        viewAggregateResult[viewId] = {
          viewId,
          rowCount: withoutFilterStats.rowCount,
          executionTime: withoutFilterStats.executionTime,
          aggregates,
        };
      });
  }

  private getAggregateFn(
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
        rawSql = `max(${dbFieldName})`;
        break;
      case StatisticsFunc.Min:
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
