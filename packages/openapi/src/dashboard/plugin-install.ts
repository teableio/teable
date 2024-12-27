import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DASHBOARD_INSTALL_PLUGIN = '/base/{baseId}/dashboard/{id}/plugin';

export const dashboardInstallPluginRoSchema = z.object({
  name: z.string(),
  pluginId: z.string(),
});

export type IDashboardInstallPluginRo = z.infer<typeof dashboardInstallPluginRoSchema>;

export const dashboardInstallPluginVoSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  pluginInstallId: z.string(),
  name: z.string(),
});

export type IDashboardInstallPluginVo = z.infer<typeof dashboardInstallPluginVoSchema>;

export const DashboardInstallPluginRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DASHBOARD_INSTALL_PLUGIN,
  description: 'Install a plugin to a dashboard',
  request: {
    params: z.object({
      baseId: z.string(),
      id: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: dashboardInstallPluginRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns data about the installed plugin.',
      content: {
        'application/json': {
          schema: dashboardInstallPluginVoSchema,
        },
      },
    },
  },
  tags: ['dashboard'],
});

export const installPlugin = async (baseId: string, id: string, ro: IDashboardInstallPluginRo) => {
  return axios.post<IDashboardInstallPluginVo>(
    urlBuilder(DASHBOARD_INSTALL_PLUGIN, { baseId, id }),
    ro
  );
};
