import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DASHBOARD_REMOVE_PLUGIN =
  '/base/{baseId}/dashboard/{dashboardId}/plugin/{pluginInstallId}';

export const DashboardRemovePluginRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DASHBOARD_REMOVE_PLUGIN,
  description: 'Remove a plugin from a dashboard',
  request: {
    params: z.object({
      baseId: z.string(),
      dashboardId: z.string(),
      pluginInstallId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Plugin removed successfully.',
    },
  },
  tags: ['dashboard'],
});

export const removePlugin = async (
  baseId: string,
  dashboardId: string,
  pluginInstallId: string
) => {
  return axios.delete(
    urlBuilder(DASHBOARD_REMOVE_PLUGIN, { baseId, dashboardId, pluginInstallId })
  );
};
