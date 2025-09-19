import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { CellFormat } from '@teable/core';
import { axios } from '../../axios';
import { baseQuerySchemaVo, type IBaseQueryVo } from '../../base';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const GET_DASHBOARD_INSTALL_PLUGIN_QUERY =
  '/plugin/chart/{pluginInstallId}/dashboard/{positionId}/query';

export const getDashboardInstallPluginQueryRoSchema = z.object({
  baseId: z.string(),
  cellFormat: z
    .nativeEnum(CellFormat, {
      errorMap: () => ({ message: 'Error cellFormat, You should set it to "json" or "text"' }),
    })
    .optional(),
});

export type IGetDashboardInstallPluginQueryRo = z.infer<
  typeof getDashboardInstallPluginQueryRoSchema
>;

export const GetDashboardInstallPluginQueryRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_DASHBOARD_INSTALL_PLUGIN_QUERY,
  description: 'Get a dashboard install plugin query by id',
  request: {
    params: z.object({
      pluginInstallId: z.string(),
      positionId: z.string(),
    }),
    query: getDashboardInstallPluginQueryRoSchema,
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
  tags: ['plugin', 'chart', 'dashboard'],
});

export const getDashboardInstallPluginQuery = async (
  pluginInstallId: string,
  positionId: string,
  query: IGetDashboardInstallPluginQueryRo
) => {
  return axios.get<IBaseQueryVo>(
    urlBuilder(GET_DASHBOARD_INSTALL_PLUGIN_QUERY, { pluginInstallId, positionId }),
    {
      params: query,
    }
  );
};
