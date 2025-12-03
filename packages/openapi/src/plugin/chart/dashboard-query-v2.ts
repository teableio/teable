import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IFilter } from '@teable/core';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const GET_DASHBOARD_INSTALL_PLUGIN_QUERY_V2 =
  '/plugin/chart/{pluginInstallId}/dashboard/{positionId}/query/v2';

export const baseQuerySchemaVoV2 = z.object({
  result: z.array(z.record(z.string(), z.unknown())),
  columns: z.array(
    z.object({
      name: z.string(),
      isNumber: z.boolean(),
    })
  ),
});

export const DEFAULT_SERIES_ARRAY = 'COUNTA';

export type IBaseQueryVoV2 = z.infer<typeof baseQuerySchemaVoV2>;

export enum THEMES_KEYS {
  BLUE = 'blue',
  GREEN = 'green',
  NEUTRAL = 'neutral',
  ORANGE = 'orange',
  RED = 'red',
  ROSE = 'rose',
  VIOLET = 'violet',
  YELLOW = 'yellow',
}

export enum ChartType {
  Bar = 'bar',
  Pie = 'pie',
  Line = 'line',
  Area = 'area',
  DonutChart = 'donutChart',
}

export enum DataSource {
  Table = 'table',
  Sql = 'sql',
}

export enum FieldRollup {
  Sum = 'sum',
  Avg = 'avg',
  Min = 'min',
  Max = 'max',
  Count = 'count',
}

export interface IStatisticFieldItem {
  fieldId: string;
  rollup: FieldRollup;
}

export interface ITableQuery {
  tableId: string;
  viewId: string;
  orderBy: {
    on: string;
    order: 'asc' | 'desc';
  };
  filter: IFilter;
  groupBy: string | null;
  xAxis: string;
  seriesArray: string | IStatisticFieldItem[];
}

interface IBaseAppearance {
  theme: string;
}

export interface IChartAppearance extends IBaseAppearance {
  legendVisible: boolean;
  labelVisible: boolean;
  padding?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
}

export interface ISqlQuery {
  sql: string | null;
}

export interface IBaseConfig {
  [key: string]: unknown;
}
export interface ISqlConfig extends IBaseConfig {
  xAxis: string;
  yAxis: string[];
}

export interface IChartStorage<T extends ITableQuery | ISqlQuery = ITableQuery | ISqlQuery> {
  chartType: ChartType;
  dataSource: DataSource;
  query: T;
  // config not make the result change
  config: ISqlConfig;
  appearance: IChartAppearance;
}

export const GetDashboardInstallPluginQueryV2Route: RouteConfig = registerRoute({
  method: 'get',
  path: GET_DASHBOARD_INSTALL_PLUGIN_QUERY_V2,
  description: 'Get a dashboard install plugin query by id',
  request: {
    params: z.object({
      pluginInstallId: z.string(),
      positionId: z.string(),
    }),
    query: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns data about the dashboard install plugin query.',
      content: {
        'application/json': {
          schema: baseQuerySchemaVoV2,
        },
      },
    },
  },
  tags: ['plugin', 'chart', 'dashboard'],
});

export const getDashboardInstallPluginQueryV2 = async (
  pluginInstallId: string,
  positionId: string,
  baseId: string
) => {
  return axios.get<IBaseQueryVoV2>(
    urlBuilder(GET_DASHBOARD_INSTALL_PLUGIN_QUERY_V2, { pluginInstallId, positionId }),
    {
      params: {
        baseId,
      },
    }
  );
};
