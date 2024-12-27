import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { IPluginInstallStorage } from './types';
import { pluginInstallStorageSchema } from './types';

export const DASHBOARD_PLUGIN_UPDATE_STORAGE =
  '/base/{baseId}/dashboard/{dashboardId}/plugin/{pluginInstallId}/update-storage';

export const dashboardPluginUpdateStorageRoSchema = z.object({
  storage: pluginInstallStorageSchema.optional(),
});

export type IDashboardPluginUpdateStorageRo = z.infer<typeof dashboardPluginUpdateStorageRoSchema>;

export const dashboardPluginUpdateStorageVoSchema = z.object({
  baseId: z.string(),
  dashboardId: z.string(),
  pluginInstallId: z.string(),
  storage: pluginInstallStorageSchema.optional(),
});

export type IDashboardPluginUpdateStorageVo = z.infer<typeof dashboardPluginUpdateStorageVoSchema>;

export const DashboardPluginUpdateStorageRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: DASHBOARD_PLUGIN_UPDATE_STORAGE,
  description: 'Update storage of a plugin in a dashboard',
  request: {
    params: z.object({
      baseId: z.string(),
      dashboardId: z.string(),
      pluginInstallId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: dashboardPluginUpdateStorageRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns data about the updated plugin.',
      content: {
        'application/json': {
          schema: dashboardPluginUpdateStorageVoSchema,
        },
      },
    },
  },
  tags: ['dashboard'],
});

export const updateDashboardPluginStorage = async (
  baseId: string,
  dashboardId: string,
  pluginInstallId: string,
  storage?: IPluginInstallStorage
) => {
  return axios.patch<IDashboardPluginUpdateStorageVo>(
    urlBuilder(DASHBOARD_PLUGIN_UPDATE_STORAGE, { baseId, dashboardId, pluginInstallId }),
    { storage }
  );
};
