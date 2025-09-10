import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { CellFormat } from '@teable/core';
import { axios } from '../axios';
import { baseQuerySchemaVo, type IBaseQueryVo } from '../base';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { getDashboardInstallPluginRoSchema } from './plugin-get';

export const GET_DASHBOARD_INSTALL_PLUGIN_QUERY =
  '/base/{baseId}/dashboard/{dashboardId}/plugin/{installPluginId}/query';

export const GetDashboardInstallPluginQueryRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_DASHBOARD_INSTALL_PLUGIN_QUERY,
  description: 'Get a dashboard install plugin query by id',
  request: {
    params: getDashboardInstallPluginRoSchema,
    query: z.object({
      cellFormat: z
        .nativeEnum(CellFormat, {
          errorMap: () => ({ message: 'Error cellFormat, You should set it to "json" or "text"' }),
        })
        .default(CellFormat.Text),
    }),
  },
  responses: {
    200: {
      description: 'Returns data about the dashboard install plugin query.',
      content: {
        'application/json': {
          schema: baseQuerySchemaVo,
        },
      },
    },
  },
  tags: ['dashboard'],
});

export const getDashboardInstallPluginQuery = async (
  baseId: string,
  dashboardId: string,
  installPluginId: string,
  cellFormat?: CellFormat
) => {
  return axios.get<IBaseQueryVo>(
    urlBuilder(GET_DASHBOARD_INSTALL_PLUGIN_QUERY, { baseId, dashboardId, installPluginId }),
    {
      params: {
        cellFormat,
      },
    }
  );
};
