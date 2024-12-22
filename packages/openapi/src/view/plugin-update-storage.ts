import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import type { IPluginInstallStorage } from '../dashboard';
import { pluginInstallStorageSchema } from '../dashboard';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const VIEW_PLUGIN_UPDATE_STORAGE = '/table/{tableId}/view/{viewId}/plugin/{pluginInstallId}';

export const viewPluginUpdateStorageRoSchema = z.object({
  storage: pluginInstallStorageSchema.optional(),
});

export type IViewPluginUpdateStorageRo = z.infer<typeof viewPluginUpdateStorageRoSchema>;

export const viewPluginUpdateStorageVoSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
  pluginInstallId: z.string(),
  storage: pluginInstallStorageSchema.optional(),
});

export type IViewPluginUpdateStorageVo = z.infer<typeof viewPluginUpdateStorageVoSchema>;

export const ViewPluginUpdateStorageRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: VIEW_PLUGIN_UPDATE_STORAGE,
  description: 'Update storage of a plugin in a view',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
      pluginInstallId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: viewPluginUpdateStorageRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns data about the updated plugin.',
      content: {
        'application/json': {
          schema: viewPluginUpdateStorageVoSchema,
        },
      },
    },
  },
  tags: ['view'],
});

export const updateViewPluginStorage = async (
  tableId: string,
  viewId: string,
  pluginInstallId: string,
  storage?: IPluginInstallStorage
) => {
  return axios.patch<IViewPluginUpdateStorageVo>(
    urlBuilder(VIEW_PLUGIN_UPDATE_STORAGE, { tableId, viewId, pluginInstallId }),
    { storage }
  );
};
