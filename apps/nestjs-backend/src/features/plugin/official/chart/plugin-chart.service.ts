import { HttpErrorCode } from '@teable/core';
import { CustomHttpException } from '../../../../custom.exception';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { IFilter, ISortItem } from '@teable/core';
import { CellFormat, mergeWithDefaultFilter, mergeWithDefaultSort } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  ISqlQuery,
  ITableQuery,
  IBaseQuery,
  IChartStorage,
  IBaseQueryVoV2,
  ITestSqlRo,
  FieldRollup,
} from '@teable/openapi';
import { DataSource, AGGREGATE_COUNT_KEY } from '@teable/openapi';
import { Knex } from 'knex';
import { keyBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { BaseQueryService } from '../../../base/base-query/base-query.service';
import { BaseSqlExecutorService } from '../../../base-sql-executor/base-sql-executor.service';
import { DashboardService } from '../../../dashboard/dashboard.service';
import { FieldService } from '../../../field/field.service';
import { PluginPanelService } from '../../../plugin-panel/plugin-panel.service';
import { RecordService } from '../../../record/record.service';

@Injectable()
export class PluginChartService {
  constructor(
    private readonly baseQueryService: BaseQueryService,
    private readonly dashboardService: DashboardService,
    private readonly pluginPanelService: PluginPanelService,
    private readonly recordService: RecordService,
    private readonly fieldService: FieldService,
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

  async getDashboardSqlResult(baseId: string, storage: { query: ISqlQuery }) {
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
        isNumber: typeof convertedResult[0][key] === 'number',
      };
    });

    return {
      result: convertedResult,
      columns: columns,
    };
  }

  private async buildViewQuery(
    viewId: string | undefined,
    filter: IFilter | undefined
  ): Promise<{ filter?: IFilter | null; sort?: ISortItem[] | null }> {
    const viewQuery = {} as { filter?: IFilter | null; sort?: ISortItem[] | null };

    if (viewId) {
      const { filter: viewFilter, sort: viewSort } =
        (await this.prismaService.txClient().view.findFirst({
          where: {
            id: viewId,
          },
          select: {
            filter: true,
            sort: true,
          },
        })) || {};
      viewQuery.filter = mergeWithDefaultFilter(viewFilter, filter);
      viewQuery.sort = mergeWithDefaultSort(viewSort, []);
    }

    return viewQuery;
  }

  private applyGroupByAndSeries(
    queryBuilder: Knex.QueryBuilder,
    fields: Array<{ id: string; dbFieldName: string }>,
    xAxis: string | string[] | undefined,
    groupBy: string | undefined,
    seriesArray: string | Array<{ column: string; rollup: FieldRollup }> | undefined
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
        const field = fields.find((field) => field.id === item.column);
        const dbFieldName = field?.dbFieldName;
        if (dbFieldName && item?.rollup) {
          const rollupMethod = item.rollup as 'sum' | 'avg' | 'min' | 'max' | 'count';
          switch (rollupMethod) {
            case 'sum':
              queryBuilder.sum({ [`${dbFieldName}_sum`]: dbFieldName });
              break;
            case 'avg':
              queryBuilder.avg({ [`${dbFieldName}_avg`]: dbFieldName });
              break;
            case 'min':
              queryBuilder.min({ [`${dbFieldName}_min`]: dbFieldName });
              break;
            case 'max':
              queryBuilder.max({ [`${dbFieldName}_max`]: dbFieldName });
              break;
            case 'count':
              queryBuilder.count({ [`${dbFieldName}_count`]: dbFieldName });
              break;
            default:
              throw new NotFoundException('Unsupported rollup method');
          }
        }
      });
    } else {
      queryBuilder.select(this.knex.raw(`COUNT(*) as ${AGGREGATE_COUNT_KEY}`));
    }
  }

  private getYColumnForOrderBy(
    groupBy: string | undefined,
    seriesArray: string | Array<{ column: string; rollup: FieldRollup }> | undefined,
    fields: Array<{ id: string; dbFieldName: string }>,
    fieldsMap: Record<string, { id: string; dbFieldName: string; name: string }>
  ): string {
    if (groupBy) {
      const groupByField = fields.find((field) => field.id === groupBy);
      if (!groupByField?.dbFieldName) {
        throw new NotFoundException('Group by field not found');
      }
      return groupByField.dbFieldName;
    }
    if (Array.isArray(seriesArray)) {
      const seriesNames = seriesArray
        .map((item) => {
          const field = fieldsMap[item.column];
          return field ? `${field.name}_${item.rollup}` : null;
        })
        .filter((name): name is string => name !== null);
      if (seriesNames.length === 0) {
        throw new NotFoundException('Series fields not found');
      }
      return seriesNames[0];
    }
    return AGGREGATE_COUNT_KEY;
  }

  private applyOrderBy(
    queryBuilder: Knex.QueryBuilder,
    orderBy: { on: string; order: string } | undefined,
    xAxis: string | string[] | undefined,
    groupBy: string | undefined,
    seriesArray: string | Array<{ column: string; rollup: FieldRollup }> | undefined,
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
    queryBuilder.orderBy(on === 'xAxis' ? dbFieldName : yColumn, order);
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
        isNumber: typeof convertedResult[0]?.[key] === 'number',
      };
    });

    return {
      result: convertedResult,
      columns,
    };
  }

  async getTableResult(storage: IChartStorage) {
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

    queryBuilder.limit(1000);

    const sql = queryBuilder.toQuery();
    console.log('dashboardPluginQueryV3:sql: ', sql);

    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ [key: string]: number }[]>(sql);

    return this.convertQueryResult(result, fields);
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
        isNumber: typeof convertedResult[0][key] === 'number',
      };
    });

    return {
      result: convertedResult,
      columns: columns,
    };
  }

  async getDashboardPluginQueryV2(
    baseId: string,
    pluginInstallId: string,
    positionId: string
  ): Promise<IBaseQueryVoV2> {
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
  }

  async getPluginPanelPluginQueryV2(
    tableId: string,
    pluginInstallId: string,
    positionId: string
  ): Promise<IBaseQueryVoV2> {
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
}
