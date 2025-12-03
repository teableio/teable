import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { IFilter, ISortItem } from '@teable/core';
import { HttpErrorCode, CellFormat, mergeWithDefaultFilter, getFieldRollupKey } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  ISqlQuery,
  ITableQuery,
  IBaseQuery,
  IChartStorage,
  IBaseQueryVoV2,
  ITestSqlRo,
  IStatisticFieldItem,
} from '@teable/openapi';
import { DataSource, AGGREGATE_COUNT_KEY, FieldRollup } from '@teable/openapi';
import { Knex } from 'knex';
import { isNumber, keyBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { CustomHttpException } from '../../../../custom.exception';
import { BaseQueryService } from '../../../base/base-query/base-query.service';
import { BaseSqlExecutorService } from '../../../base-sql-executor/base-sql-executor.service';
import { DashboardService } from '../../../dashboard/dashboard.service';
import { PluginPanelService } from '../../../plugin-panel/plugin-panel.service';
import { RecordService } from '../../../record/record.service';

const maxResultLimit = 1000;

@Injectable()
export class PluginChartService {
  private readonly logger = new Logger(PluginChartService.name);

  constructor(
    private readonly baseQueryService: BaseQueryService,
    private readonly dashboardService: DashboardService,
    private readonly pluginPanelService: PluginPanelService,
    private readonly recordService: RecordService,
    private readonly prismaService: PrismaService,
    private readonly baseSqlExecutorService: BaseSqlExecutorService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  async getDashboardPluginQuery(
    pluginInstallId: string,
    positionId: string,
    baseId: string,
    cellFormat: CellFormat = CellFormat.Text
  ) {
    const { storage } = await this.dashboardService.getPluginInstall(
      baseId,
      positionId,
      pluginInstallId
    );
    const query = storage?.query as IBaseQuery;
    if (!query) {
      throw new CustomHttpException(
        'Dashboard Plugin Storage Query not found',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.pluginChart.queryNotFound',
          },
        }
      );
    }
    return this.baseQueryService.baseQuery(baseId, query, cellFormat);
  }

  async getPluginPanelPluginQuery(
    pluginInstallId: string,
    positionId: string,
    tableId: string,
    cellFormat: CellFormat = CellFormat.Text
  ) {
    const { baseId, storage } = await this.pluginPanelService.getPluginPanelPlugin(
      tableId,
      positionId,
      pluginInstallId
    );
    const query = storage?.query as IBaseQuery;
    if (!query) {
      throw new CustomHttpException(
        'Plugin Panel Plugin Storage Query not found',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.pluginChart.queryNotFound',
          },
        }
      );
    }
    return this.baseQueryService.baseQuery(baseId, query, cellFormat);
  }

  async getDashboardPluginQueryV2(
    baseId: string,
    pluginInstallId: string,
    positionId: string
  ): Promise<IBaseQueryVoV2> {
    try {
      const { storage } = await this.dashboardService.getPluginInstall(
        baseId,
        positionId,
        pluginInstallId
      );
      const { dataSource } = storage as unknown as IChartStorage;

      if (dataSource === DataSource.Sql) {
        return await this.getDashboardSqlResult(
          baseId,
          storage as unknown as IChartStorage<ISqlQuery>
        );
      }

      return await this.getTableResult(storage as unknown as IChartStorage<ITableQuery>);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      this.logger.error(`Error getting dashboard plugin query v2: ${error?.message}`, error?.stack);
      return {
        result: [],
        columns: [],
      };
    }
  }

  async getPluginPanelPluginQueryV2(
    tableId: string,
    pluginInstallId: string,
    positionId: string
  ): Promise<IBaseQueryVoV2> {
    try {
      const baseId = await this.pluginPanelService.getBaseId(tableId);

      const { storage } = await this.pluginPanelService.getPluginPanelPlugin(
        tableId,
        positionId,
        pluginInstallId
      );

      const { dataSource } = storage as unknown as IChartStorage;

      if (dataSource === DataSource.Sql) {
        return await this.getDashboardSqlResult(
          baseId,
          storage as unknown as IChartStorage<ISqlQuery>
        );
      }

      return await this.getTableResult(storage as unknown as IChartStorage<ITableQuery>);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      this.logger.error(
        `Error getting plugin panel plugin query v2: ${error?.message}`,
        error?.stack
      );
      return {
        result: [],
        columns: [],
      };
    }
  }

  async testSql(testSqlRo: ITestSqlRo) {
    const { baseId, sql } = testSqlRo;

    if (!sql) {
      return {
        result: [],
        columns: [],
      };
    }

    const result = await this.baseSqlExecutorService.executeQuerySql<{ [key: string]: unknown }[]>(
      baseId,
      sql
    );

    if (result.length === 0) {
      return {
        result: [],
        columns: [],
      };
    }

    // Convert BigInt to Number for JSON serialization
    const convertedResult = result.map((row) => {
      const converted: { [key: string]: unknown } = {};
      for (const [key, value] of Object.entries(row)) {
        converted[key] = typeof value === 'bigint' ? Number(value) : value;
      }
      return converted;
    });

    const columnKeys = convertedResult[0] ? Object.keys(convertedResult[0]) : [];

    const columns = columnKeys.map((key) => {
      return {
        name: key,
        isNumber: convertedResult?.some((item) => isNumber(item[key])),
      };
    });

    return {
      result: convertedResult,
      columns: columns,
    };
  }

  // get schema by baseId for sql query assist
  async getSchemaByBaseId(baseId: string) {
    const tableRecords = await this.prismaService.txClient().tableMeta.findMany({
      where: {
        baseId,
        deletedTime: null,
      },
      select: {
        dbTableName: true,
      },
    });

    if (!tableRecords.length) {
      return {};
    }

    const tableNames = tableRecords.map((t) => t.dbTableName.split('.').pop());

    const columnSqlQuery = this.knex
      .select({
        tableName: 'table_name',
        columnName: 'column_name',
      })
      .from('information_schema.columns')
      .whereIn('table_name', tableNames as string[])
      .where('table_schema', baseId)
      .toQuery();

    const columns = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ tableName: string; columnName: string }[]>(columnSqlQuery);

    const schema: Record<string, string[]> = {};

    for (const table of tableRecords) {
      const key = `${table.dbTableName}`;

      const tableColumns = columns
        .filter((col) => col.tableName === table.dbTableName.split('.').pop())
        .map((col) => col.columnName);

      schema[key] = tableColumns;
    }

    return schema;
  }

  private async getDashboardSqlResult(baseId: string, storage: { query: ISqlQuery }) {
    const sql = storage?.query?.sql;

    if (!sql) {
      return {
        result: [],
        columns: [],
      };
    }

    const result = await this.baseSqlExecutorService.executeQuerySql<{ [key: string]: unknown }[]>(
      baseId,
      sql
    );

    if (result.length === 0) {
      return {
        result: [],
        columns: [],
      };
    }

    // Convert BigInt to Number for JSON serialization
    const convertedResult = result.map((row) => {
      const converted: { [key: string]: unknown } = {};
      for (const [key, value] of Object.entries(row)) {
        converted[key] = typeof value === 'bigint' ? Number(value) : value;
      }
      return converted;
    });

    const columnKeys = convertedResult[0] ? Object.keys(convertedResult[0]) : [];

    const columns = columnKeys.map((key) => {
      return {
        name: key,
        isNumber: convertedResult?.some((item) => isNumber(item[key])),
      };
    });

    return {
      result: convertedResult,
      columns: columns,
    };
  }

  private async getTableResult(storage: IChartStorage) {
    const { query } = storage;
    const { tableId, groupBy, seriesArray, xAxis, viewId, filter, orderBy } = query as ITableQuery;

    if (Array.isArray(xAxis) && xAxis.length === 0) {
      return {
        result: [],
        columns: [],
      };
    }

    const fields = await this.prismaService.txClient().field.findMany({
      where: {
        tableId,
        deletedTime: null,
      },
      select: {
        id: true,
        dbFieldName: true,
        name: true,
      },
    });

    const fieldsMap = keyBy(fields, 'id');

    const viewQuery = await this.buildViewQuery(viewId, filter);

    const { queryBuilder: mainQueryBuilder } = await this.recordService.buildFilterSortQuery(
      tableId,
      {
        ...viewQuery,
      }
    );

    const dbTableName = await this.prismaService
      .txClient()
      .tableMeta.findUnique({
        where: { id: tableId },
        select: { dbTableName: true },
      })
      .then((meta) => meta?.dbTableName);

    if (!dbTableName) {
      throw new NotFoundException('Table not found');
    }

    const queryBuilder = this.knex.from(mainQueryBuilder.as('filtered_records'));

    this.applyGroupByAndSeries(
      queryBuilder,
      fields,
      xAxis ?? undefined,
      groupBy ?? undefined,
      seriesArray
    );

    this.applyOrderBy(
      queryBuilder,
      orderBy,
      xAxis ?? undefined,
      groupBy ?? undefined,
      seriesArray,
      fields,
      fieldsMap
    );

    queryBuilder.limit(maxResultLimit);

    const sql = queryBuilder.toQuery();

    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ [key: string]: number }[]>(sql);

    return this.convertQueryResult(result, fields);
  }

  private convertQueryResult(
    result: { [key: string]: number }[],
    fields: Array<{ id: string; dbFieldName: string; name: string }>
  ): { result: { [key: string]: number }[]; columns: Array<{ name: string; isNumber: boolean }> } {
    const fieldNameMap = new Map<string, string>();
    fields.forEach((field) => {
      fieldNameMap.set(field.dbFieldName, field.name);
    });

    const convertedResult = result.map((row) => {
      const converted: { [key: string]: number } = {};
      for (const [key, value] of Object.entries(row)) {
        const name = fieldNameMap.get(key) || key;
        converted[name] = typeof value === 'bigint' ? Number(value) : value;
      }
      return converted;
    });

    const columnKeys = convertedResult[0] ? Object.keys(convertedResult[0]) : [];
    const columns = columnKeys.map((key) => {
      return {
        name: key,
        isNumber: convertedResult?.some((item) => isNumber(item[key])),
      };
    });

    return {
      result: convertedResult,
      columns,
    };
  }

  private async buildViewQuery(
    viewId: string | undefined,
    filter: IFilter | undefined
  ): Promise<{ filter?: IFilter | null; sort?: ISortItem[] | null }> {
    const viewQuery = {
      filter: filter,
    } as { filter?: IFilter | null };

    if (viewId) {
      const { filter: viewFilter } =
        (await this.prismaService.txClient().view.findFirst({
          where: {
            id: viewId,
            deletedTime: null,
          },
          select: {
            filter: true,
            sort: true,
          },
        })) || {};
      viewQuery.filter = mergeWithDefaultFilter(viewFilter, filter);
    }

    return viewQuery;
  }

  private applyGroupByAndSeries(
    queryBuilder: Knex.QueryBuilder,
    fields: Array<{ id: string; dbFieldName: string }>,
    xAxis: string | string[] | undefined,
    groupBy: string | undefined,
    seriesArray: string | Array<IStatisticFieldItem>
  ): void {
    if (xAxis && typeof xAxis === 'string') {
      const dbFieldName = fields.find((field) => field.id === xAxis)?.dbFieldName;
      queryBuilder.select({ [xAxis]: dbFieldName });
      queryBuilder.groupBy(xAxis);
    }
    if (groupBy) {
      const dbFieldName = fields.find((field) => field.id === groupBy)?.dbFieldName;
      queryBuilder.select({ [groupBy]: dbFieldName });
      queryBuilder.groupBy(groupBy);
    }
    if (Array.isArray(seriesArray) && seriesArray.length) {
      seriesArray.forEach((item) => {
        const field = fields.find((field) => field.id === item.fieldId);
        const dbFieldName = field?.dbFieldName;
        if (dbFieldName && item?.rollup && field?.id) {
          const rollupMethod = item.rollup as FieldRollup;
          const rollupKey = getFieldRollupKey(field.id, rollupMethod);
          switch (rollupMethod) {
            case FieldRollup.Sum:
              queryBuilder.sum({ [rollupKey]: dbFieldName });
              break;
            case FieldRollup.Avg:
              queryBuilder.avg({ [rollupKey]: dbFieldName });
              break;
            case FieldRollup.Min:
              queryBuilder.min({ [rollupKey]: dbFieldName });
              break;
            case FieldRollup.Max:
              queryBuilder.max({ [rollupKey]: dbFieldName });
              break;
            case FieldRollup.Count:
              queryBuilder.count({ [rollupKey]: dbFieldName });
              break;
            default:
              throw new NotFoundException('Unsupported rollup method');
          }
        }
      });
    } else {
      queryBuilder.count({ [AGGREGATE_COUNT_KEY]: '*' });
    }
  }

  private getYColumnForOrderBy(
    groupBy: string | undefined,
    seriesArray: string | Array<IStatisticFieldItem>,
    fields: Array<{ id: string; dbFieldName: string }>,
    fieldsMap: Record<string, { id: string; dbFieldName: string; name: string }>
  ): string[] {
    if (groupBy) {
      const groupByField = fields.find((field) => field.id === groupBy);
      if (!groupByField?.dbFieldName) {
        throw new NotFoundException('Group by field not found');
      }
      return [groupByField.dbFieldName];
    }
    if (Array.isArray(seriesArray)) {
      const seriesNames = seriesArray
        .map((item) => {
          const field = fieldsMap[item.fieldId];
          const rollupKey = getFieldRollupKey(field.id, item.rollup);
          return field ? rollupKey : null;
        })
        .filter((name): name is string => name !== null);
      if (seriesNames.length === 0) {
        throw new NotFoundException('Series fields not found');
      }
      return seriesNames;
    }
    return [AGGREGATE_COUNT_KEY];
  }

  private applyOrderBy(
    queryBuilder: Knex.QueryBuilder,
    orderBy: { on: string; order: string } | undefined,
    xAxis: string | string[] | undefined,
    groupBy: string | undefined,
    seriesArray: string | Array<IStatisticFieldItem>,
    fields: Array<{ id: string; dbFieldName: string }>,
    fieldsMap: Record<string, { id: string; dbFieldName: string; name: string }>
  ): void {
    if (!orderBy) {
      return;
    }

    const { on, order } = orderBy;
    const xAxisField =
      xAxis && typeof xAxis === 'string' ? fields.find((field) => field.id === xAxis) : undefined;
    const dbFieldName = xAxisField?.dbFieldName;

    if (!dbFieldName) {
      throw new NotFoundException('X-axis field not found');
    }

    const yColumn = this.getYColumnForOrderBy(groupBy, seriesArray, fields, fieldsMap);
    if (on === 'xAxis') {
      queryBuilder.orderBy(dbFieldName, order);
    } else {
      yColumn.forEach((column) => {
        queryBuilder.orderBy(column, order);
      });
    }
  }
}
