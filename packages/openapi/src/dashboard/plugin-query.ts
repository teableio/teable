import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { baseQuerySchemaVo, type IBaseQueryVo } from '../base';
import { registerRoute, urlBuilder } from '../utils';
import { getDashboardInstallPluginRoSchema } from './plugin-get';

export const GET_DASHBOARD_INSTALL_PLUGIN_QUERY =
  '/base/{baseId}/dashboard/{dashboardId}/plugin/{installPluginId}/query';

export const GetDashboardInstallPluginQueryRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_DASHBOARD_INSTALL_PLUGIN_QUERY,
  description: 'Get a dashboard install plugin query by id',
  request: {
    params: getDashboardInstallPluginRoSchema,
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
  installPluginId: string
) => {
  return axios.get<IBaseQueryVo>(
    urlBuilder(GET_DASHBOARD_INSTALL_PLUGIN_QUERY, { baseId, dashboardId, installPluginId })
  );
};
