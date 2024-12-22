import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DASHBOARD_PLUGIN_RENAME =
  '/base/{baseId}/dashboard/{dashboardId}/plugin/{pluginInstallId}/rename';

export const dashboardPluginRenameRoSchema = z.object({
  name: z.string(),
});

export type IDashboardPluginRenameRo = z.infer<typeof dashboardPluginRenameRoSchema>;

export const dashboardPluginRenameVoSchema = z.object({
  id: z.string(),
  pluginInstallId: z.string(),
  name: z.string(),
});

export type IDashboardPluginRenameVo = z.infer<typeof dashboardPluginRenameVoSchema>;

export const DashboardPluginRenameRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: DASHBOARD_PLUGIN_RENAME,
  description: 'Rename a plugin in a dashboard',
  request: {
    params: z.object({
      baseId: z.string(),
      id: z.string(),
      pluginInstallId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: dashboardPluginRenameRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns data about the renamed plugin.',
      content: {
        'application/json': {
          schema: dashboardPluginRenameVoSchema,
        },
      },
    },
  },
  tags: ['dashboard'],
});

export const renamePlugin = async (
  baseId: string,
  dashboardId: string,
  pluginInstallId: string,
  name: string
) => {
  return axios.patch<IDashboardPluginRenameVo>(
    urlBuilder(DASHBOARD_PLUGIN_RENAME, { baseId, dashboardId, pluginInstallId }),
    { name }
  );
};
