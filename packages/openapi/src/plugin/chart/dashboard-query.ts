import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { CellFormat } from '@teable/core';
import { axios } from '../../axios';
import { baseQuerySchemaVo, type IBaseQueryVo } from '../../base';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const GET_DASHBOARD_INSTALL_PLUGIN_QUERY =
  '/plugin/chart/{installPluginId}/dashboard/{positionId}/query';

export const getDashboardInstallPluginQueryRoSchema = z.object({
  baseId: z.string(),
  cellFormat: z
    .nativeEnum(CellFormat, {
      errorMap: () => ({ message: 'Error cellFormat, You should set it to "json" or "text"' }),
    })
    .default(CellFormat.Text)
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
      installPluginId: z.string(),
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
  installPluginId: string,
  positionId: string,
  query: IGetDashboardInstallPluginQueryRo
) => {
  return axios.get<IBaseQueryVo>(
    urlBuilder(GET_DASHBOARD_INSTALL_PLUGIN_QUERY, { installPluginId, positionId }),
    {
      params: query,
    }
  );
};
