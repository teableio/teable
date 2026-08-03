import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { pluginInstallStorageSchema } from './types';

export const GET_DASHBOARD_INSTALL_PLUGIN =
  '/base/{baseId}/dashboard/{dashboardId}/plugin/{pluginInstallId}';

export const getDashboardInstallPluginRoSchema = z.object({
  baseId: z.string(),
  dashboardId: z.string(),
  pluginInstallId: z.string(),
});

export const getDashboardInstallPluginVoSchema = z.object({
  pluginId: z.string(),
  pluginInstallId: z.string(),
  baseId: z.string(),
  name: z.string(),
  storage: pluginInstallStorageSchema.optional(),
});

export type IGetDashboardInstallPluginVo = z.infer<typeof getDashboardInstallPluginVoSchema>;

export const GetDashboardInstallPluginRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_DASHBOARD_INSTALL_PLUGIN,
  description: 'Get a dashboard install plugin by id',
  request: {
    params: getDashboardInstallPluginRoSchema,
  },
  responses: {
    200: {
      description: 'Returns data about the dashboard install plugin.',
      content: {
        'application/json': {
          schema: getDashboardInstallPluginVoSchema,
        },
      },
    },
  },
  tags: ['dashboard'],
});

export const getDashboardInstallPlugin = async (
  baseId: string,
  dashboardId: string,
  pluginInstallId: string
) => {
  return axios.get<IGetDashboardInstallPluginVo>(
    urlBuilder(GET_DASHBOARD_INSTALL_PLUGIN, { baseId, dashboardId, pluginInstallId })
  );
};
