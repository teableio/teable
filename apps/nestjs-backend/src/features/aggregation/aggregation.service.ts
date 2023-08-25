import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  IAggregations,
  IAggregationsValue,
  IFilter,
  IViewAggregationVo,
} from '@teable-group/core';
import { FieldKeyType, mergeWithDefaultFilter, ViewType, StatisticsFunc } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import type { AsyncFunction } from 'async';
import async from 'async';
import dayjs from 'dayjs';
import type { Knex } from 'knex';
import knex from 'knex';
import { difference, keyBy } from 'lodash';
import { PrismaService } from '../../prisma.service';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { FilterQueryTranslator } from '../record/translator/filter-query-translator';
import { getSimpleAggRawSql } from './aggregation-function-mappings';

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
  field: IFieldInstance;
  statisticFunc: StatisticsFunc;
};

type ITaskResult = {
  viewId: string;
  rawAggregationData?: { [field: string]: unknown };
  executionTime: number;
};

export type IAggCalcCallback = (data?: IViewAggregationVo, error?: unknown) => Promise<void>;

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
    callBack?: IAggCalcCallback
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

    // 3.Create aggregation all task
    const asyncTasks: Array<AsyncFunction<ITaskResult>> = [];
    viewStatisticsData.forEach(({ viewId, filter, statisticFields }) => {
      const aggregationTask = this.createAggTask(
        dbTableName,
        viewId,
        fieldInstanceMap,
        filter,
        statisticFields
      );
      if (!aggregationTask) {
        this.setAggDefaultToNull(
          asyncTasks,
          { viewId, withFieldIds, withView, statisticFields },
          callBack
        );
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
      asyncTasks.push(asyncFunction);
    });
    const taskResults = await async.parallel<ITaskResult, ITaskResult[]>(asyncTasks);

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

  async calculateSpecifyAggregation(
    tableId: string,
    fieldIdOrName: string,
    viewId: string,
    func: StatisticsFunc,
    fieldKeyType: FieldKeyType = FieldKeyType.Name
  ): Promise<IAggregationsValue> {
    let fieldId = fieldIdOrName;
    if (fieldKeyType === FieldKeyType.Name) {
      const fieldRaw = await this.prisma.field
        .findFirstOrThrow({
          where: { [fieldKeyType]: fieldIdOrName, tableId, deletedTime: null },
          select: { id: true },
        })
        .catch(() => {
          throw new BadRequestException('Field not found');
        });
      fieldId = fieldRaw.id;
    }

    const result = await this.calculateAggregations({
      tableId,
      withView: {
        viewId,
        customFieldStats: [
          {
            fieldId,
            statisticFunc: func,
          },
        ],
      },
      withFieldIds: [fieldId],
    });

    const agg = result[viewId].aggregations?.[fieldId]?.total;
    if (!agg) {
      throw new BadRequestException('Aggregation not found');
    }
    return agg;
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

    fieldInstances.forEach((instance) => {
      const { id: fieldId, columnMeta } = instance;
      const viewFieldMeta = columnMeta[viewId];

      if (viewFieldMeta || customFieldStatsMap) {
        const { hidden, statisticFunc } = viewFieldMeta;
        const func = customFieldStatsMap[fieldId]?.statisticFunc ?? statisticFunc;

        if (hidden !== true && func) {
          statisticFields.push({
            field: instance,
            statisticFunc: func,
          });
        }
      }
    });
    return statisticFields;
  }

  private createAggTask(
    dbTableName: string,
    viewId: string,
    fieldInstanceMap: Record<string, IFieldInstance>,
    filter?: IFilter,
    statisticFields?: IStatisticField[]
  ) {
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

  private setAggDefaultToNull(
    allTasks: Array<AsyncFunction<ITaskResult>>,
    params: {
      viewId: string;
      withFieldIds?: string[];
      withView?: IWithView;
      statisticFields?: IStatisticField[];
    },
    callBack?: IAggCalcCallback
  ) {
    const { withFieldIds, withView, statisticFields, viewId } = params;
    if (!withFieldIds && !withView) {
      return;
    }

    const targetFieldIds =
      withView?.customFieldStats?.map((field) => field.fieldId) ?? withFieldIds;
    const sourceFieldIds = statisticFields?.map((v) => v.field.id) || [];
    const diffFieldIds = difference(targetFieldIds, sourceFieldIds);

    diffFieldIds.forEach((fieldId) => {
      const asyncFunction = (next: (err?: Error | null, data?: ITaskResult) => void) => {
        const taskResult = {
          viewId,
          rawAggregationData: {
            [fieldId]: null,
          },
          executionTime: new Date().getTime(),
        };

        callBack &&
          callBack({
            [taskResult.viewId]: this.formatTaskResult(taskResult),
          });

        next(null, taskResult);
      };
      allTasks.push(asyncFunction);
    });
  }

  private formatTaskResult = (taskResult: ITaskResult) => {
    const aggregations: IAggregations = {};
    for (const [key, value] of Object.entries(taskResult.rawAggregationData || {})) {
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
    } else {
      rawSql = getSimpleAggRawSql(dbTableName, field, func);
    }

    return kq.select(this.knex.raw(`${rawSql} as ${fieldId}_${func}`));
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
