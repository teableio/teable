import { Injectable, Logger } from '@nestjs/common';
import type {
  IAggregations,
  IFilter,
  IViewAggregationVo,
  IViewRowCountVo,
  IViewAggregationValue,
  IViewRowCountValue,
} from '@teable-group/core';
import { mergeWithDefaultFilter, StatisticsFunc, ViewType } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import dayjs from 'dayjs';
import type { Knex } from 'knex';
import knex from 'knex';
import { difference, keyBy, sortBy } from 'lodash';
import type { Observable } from 'rxjs';
import { catchError, firstValueFrom, from, mergeMap, of, Subject, tap, toArray } from 'rxjs';
import { PrismaService } from '../../prisma.service';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { FilterQueryTranslator } from '../record/translator/filter-query-translator';
import { getSimpleAggRawSql } from './aggregation-function-mappings';

export type IWithView = {
  viewId?: string;
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
  field: IFieldInstance;
  statisticFunc: StatisticsFunc;
};

type ITaskResult = {
  viewId: string;
  executionTime: number;
  rawAggregationData?: { [field: string]: unknown };
  rawRowCountData?: number;
};

export type IAggCalcCallback = (
  data: IViewAggregationVo | IViewRowCountVo | null,
  error?: unknown
) => Promise<void>;

@Injectable()
export class AggregationService {
  private logger = new Logger(AggregationService.name);
  private readonly knex = knex({ client: 'sqlite3' });

  constructor(private prisma: PrismaService) {}

  async calculateViewField(params: {
    tableId: string;
    withFieldIds?: string[];
    withView?: IWithView;
  }): Promise<IViewAggregationVo> {
    const config = {
      fieldAggregation: true,
    };
    return (await this.performAggregation(params, config)) as IViewAggregationVo;
  }

  async calculateViewRowCount(params: {
    tableId: string;
    withView?: Omit<IWithView, 'customFieldStats'>;
  }): Promise<IViewRowCountVo> {
    const config = {
      rowCount: true,
    };
    return (await this.performAggregation(params, config)) as IViewRowCountVo;
  }

  async performAggregation(
    params: {
      tableId: string;
      withFieldIds?: string[];
      withView?: IWithView;
    },
    config: {
      fieldAggregation?: boolean;
      rowCount?: boolean;
    },
    callBack?: IAggCalcCallback
  ): Promise<IViewAggregationVo | IViewRowCountVo> {
    const { tableId, withFieldIds, withView } = params;
    const { fieldAggregation, rowCount } = config;

    // 1.Get view statistics data
    const { viewStatisticsData, fieldInstanceMap } = await this.getViewStatisticsData(
      tableId,
      withView,
      withFieldIds
    );

    // 2.Get database table name
    const dbTableName = await this.getDbTableName(this.prisma, tableId);

    // 3.Create aggregation all task
    const tasks: Array<Observable<ITaskResult | null>> = [];
    const callBackSubject = new Subject<IViewAggregationVo | IViewRowCountVo>();

    this.sortByStatistic(viewStatisticsData).forEach(({ viewId, filter, statisticFields }) => {
      if (rowCount) {
        const rowCountTask = this.createRowCountTask(
          { dbTableName, viewId, fieldInstanceMap, filter },
          callBackSubject
        );
        rowCountTask && tasks.push(rowCountTask);
      }

      if (fieldAggregation) {
        const aggregationTask = this.createAggTask(
          { dbTableName, viewId, fieldInstanceMap, filter, statisticFields },
          callBackSubject
        );

        if (!aggregationTask) {
          const aggDefaultToNullTask = this.createAggDefaultToNullTasks(
            { statisticFields, withView },
            callBackSubject
          );
          aggDefaultToNullTask && tasks.push(...aggDefaultToNullTask);
        } else {
          tasks.push(aggregationTask);
        }
      }
    });

    callBackSubject.subscribe({
      next: (value) => {
        callBack && callBack(value);
      },
      error: (err) => {
        this.logger.error(err?.message, err?.stack);
        callBack && callBack(null, err);
      },
    });

    const taskResults = await firstValueFrom(
      from(tasks).pipe(
        mergeMap((task) => task),
        toArray()
      )
    );

    const result: IViewAggregationVo | IViewRowCountVo = {};
    // Format task results and populate viewAggregationResult
    if (taskResults) {
      taskResults
        .filter(Boolean)
        .map((value) => this.formatTaskResult(value as ITaskResult))
        .forEach((res) => res && (result[res.viewId] = res));
    }
    return result;
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
        ...(withView && withView.viewId ? { id: withView.viewId } : {}),
        type: { in: [ViewType.Grid, ViewType.Gantt] },
        deletedTime: null,
      },
    });

    const viewStatisticsData: IViewStatisticsData = [];
    for (const view of viewRaw) {
      let filter;
      if (view.filter || (view.id === withView?.viewId && withView?.customFilter)) {
        filter = await mergeWithDefaultFilter(view.filter, withView?.customFilter);
      }

      viewStatisticsData.push({ viewId: view.id, filter });
    }

    const { fieldInstances, fieldInstanceMap } = await this.getFieldsData(tableId);

    const targetFieldIds =
      withView?.customFieldStats?.map((field) => field.fieldId) ?? withFieldIds;
    const filteredFieldInstances = !targetFieldIds?.length
      ? fieldInstances
      : fieldInstances.filter((instance) => {
          return targetFieldIds.includes(instance.id);
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

  async getFieldsData(tableId: string, fieldIds?: string[]) {
    const fieldsRaw = await this.prisma.field.findMany({
      where: { tableId, ...(fieldIds ? { id: { in: fieldIds } } : {}), deletedTime: null },
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
    let statisticFields: IStatisticField[] | undefined;
    const customFieldStatsMap = keyBy(customFieldStats, 'fieldId');

    fieldInstances.forEach((instance) => {
      const { id: fieldId, columnMeta } = instance;
      const viewFieldMeta = columnMeta[viewId];

      if (viewFieldMeta || customFieldStatsMap) {
        const { hidden, statisticFunc } = viewFieldMeta;
        const func = customFieldStatsMap[fieldId]?.statisticFunc ?? statisticFunc;

        if (hidden !== true && func) {
          (statisticFields = statisticFields ?? []).push({
            field: instance,
            statisticFunc: func,
          });
        }
      }
    });
    return statisticFields;
  }

  private createAggTask(
    params: {
      dbTableName: string;
      viewId: string;
      fieldInstanceMap: Record<string, IFieldInstance>;
      filter?: IFilter;
      statisticFields?: IStatisticField[];
    },
    callBackSubject: Subject<IViewAggregationVo | IViewRowCountVo>
  ) {
    const { dbTableName, viewId, fieldInstanceMap, filter, statisticFields } = params;
    if (!statisticFields?.length) {
      return;
    }

    const tableAlias = 'main_table';
    const queryBuilder = this.knex
      .with(tableAlias, (qb) => {
        qb.select('*').from(dbTableName);
        if (filter) {
          new FilterQueryTranslator(qb, fieldInstanceMap, filter).translateToSql();
        }
      })
      .from(tableAlias);

    // Function to get aggregation data
    const getAggregationData = async (
      prisma: Prisma.TransactionClient,
      queryBuilder: Knex.QueryBuilder
    ) => {
      // Get Aggregation functions for each field
      statisticFields.forEach(({ field, statisticFunc }) => {
        this.getAggregationFunc(queryBuilder, tableAlias, field, statisticFunc);
      });

      const sqlNative = queryBuilder.toSQL().toNative();
      return prisma.$queryRawUnsafe<{ [field: string]: unknown }[]>(
        sqlNative.sql,
        ...sqlNative.bindings
      );
    };

    // Return promise that resolves to task result
    const task = new Promise<ITaskResult>((resolve, reject) => {
      getAggregationData(this.prisma, queryBuilder)
        .then((rawAggregationData) => {
          resolve({
            viewId,
            executionTime: new Date().getTime(),
            rawAggregationData: rawAggregationData && rawAggregationData[0],
          });
        })
        .catch(reject);
    });
    return this.wrapTaskAsObservable(task, callBackSubject);
  }

  private createAggDefaultToNullTasks(
    params: {
      withView?: IWithView;
      statisticFields?: IStatisticField[];
    },
    callBackSubject: Subject<IViewAggregationVo | IViewRowCountVo>
  ) {
    const { withView, statisticFields } = params;
    const viewId = withView && withView?.viewId;
    if (!viewId) {
      return;
    }

    const tasks: Array<Observable<ITaskResult | null>> = [];
    const targetFieldIds = withView?.customFieldStats?.map((field) => field.fieldId);
    const sourceFieldIds = statisticFields?.map((v) => v.field.id) || [];
    const diffFieldIds = difference(targetFieldIds, sourceFieldIds);

    diffFieldIds.forEach((fieldId) => {
      const taskResult = of({
        viewId: viewId,
        rawAggregationData: {
          [fieldId]: null,
        },
        executionTime: new Date().getTime(),
      });

      tasks.push(this.wrapTaskAsObservable(taskResult, callBackSubject));
    });
    return tasks;
  }

  private createRowCountTask(
    params: {
      dbTableName: string;
      viewId: string;
      fieldInstanceMap: Record<string, IFieldInstance>;
      filter?: IFilter;
    },
    callBackSubject: Subject<IViewAggregationVo | IViewRowCountVo>
  ) {
    const { dbTableName, viewId, fieldInstanceMap, filter } = params;

    const queryBuilder = this.knex(dbTableName);

    if (filter) {
      new FilterQueryTranslator(queryBuilder, fieldInstanceMap, filter).translateToSql();
    }

    // Return promise that resolves to task result
    const task = new Promise<ITaskResult>((resolve, reject) => {
      this.getRowCount(this.prisma, queryBuilder)
        .then((rawRowCountData) => {
          resolve({
            viewId,
            executionTime: new Date().getTime(),
            rawRowCountData: Number(rawRowCountData[0]?.count ?? 0),
          });
        })
        .catch(reject);
    });
    return this.wrapTaskAsObservable(task, callBackSubject);
  }

  private wrapTaskAsObservable(
    task: Promise<ITaskResult> | Observable<ITaskResult>,
    callBackSubject: Subject<IViewAggregationVo | IViewRowCountVo>
  ): Observable<ITaskResult | null> {
    return from(task).pipe(
      tap((taskResult) => {
        const formatTaskResult = this.formatTaskResult(taskResult);

        formatTaskResult &&
          callBackSubject.next({ [taskResult.viewId]: formatTaskResult } as
            | IViewAggregationVo
            | IViewRowCountVo);
      }),
      catchError((err) => {
        callBackSubject.error(err);
        return of(null);
      })
    );
  }

  private formatTaskResult = (
    taskResult: ITaskResult
  ): IViewAggregationValue | IViewRowCountValue | undefined => {
    if (taskResult.rawAggregationData) {
      const aggregations: IAggregations = {};
      for (const [key, value] of Object.entries(taskResult.rawAggregationData)) {
        const [fieldId, aggFunc] = key.split('_') as [string, StatisticsFunc | undefined];

        const convertValue = this.formatConvertValue(value, aggFunc);

        if (fieldId) {
          aggregations[fieldId] = aggFunc
            ? { total: { value: convertValue, aggFunc: aggFunc } }
            : null;
        }
      }

      return {
        viewId: taskResult.viewId,
        executionTime: taskResult.executionTime,
        aggregations,
      };
    }

    if (taskResult.rawRowCountData) {
      return {
        viewId: taskResult.viewId,
        executionTime: taskResult.executionTime,
        rowCount: taskResult.rawRowCountData,
      };
    }
  };

  private formatConvertValue = (currentValue: unknown, aggFunc?: StatisticsFunc) => {
    let convertValue =
      typeof currentValue === 'bigint' || typeof currentValue === 'number'
        ? Number(currentValue)
        : currentValue?.toString() ?? null;

    if (!aggFunc) {
      return convertValue;
    }

    if (aggFunc === StatisticsFunc.DateRangeOfMonths) {
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

      const withRawSql = getSimpleAggRawSql(dbTableName, field, func);
      kq.with(`${fieldId}_mcv`, this.knex.raw(withRawSql));
      kq.join(this.knex.raw(joinTable));

      rawSql = `${joinTable}.value`;

      if (!kq.toQuery().includes('max(1) as _ignore')) {
        kq.select(this.knex.raw(`max(1) as _ignore`));
      }
    } else {
      rawSql = getSimpleAggRawSql(dbTableName, field, func);
    }

    return kq.select(this.knex.raw(`${rawSql} as ${fieldId}_${func}`));
  }

  private sortByStatistic(viewStatisticsData: IViewStatisticsData) {
    const delayStats = [StatisticsFunc.Unique, StatisticsFunc.PercentUnique];

    return sortBy(
      viewStatisticsData,
      (value) => {
        return value.statisticFields?.length ?? 0;
      },
      (value) => {
        const index =
          value.statisticFields?.findIndex((value) => delayStats.includes(value.statisticFunc)) ??
          -1;
        return index >= 0 ? 1 : 0;
      }
    );
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
