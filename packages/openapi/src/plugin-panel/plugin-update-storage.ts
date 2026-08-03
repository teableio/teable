import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { pluginInstallStorageSchema } from '../dashboard';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_PANEL_UPDATE_STORAGE =
  '/table/{tableId}/plugin-panel/{pluginPanelId}/plugin/{pluginInstallId}/update-storage';

export const pluginPanelUpdateStorageRoSchema = z.object({
  storage: pluginInstallStorageSchema.optional(),
});

export type IPluginPanelUpdateStorageRo = z.infer<typeof pluginPanelUpdateStorageRoSchema>;

export const pluginPanelUpdateStorageVoSchema = z.object({
  tableId: z.string(),
  pluginPanelId: z.string(),
  pluginInstallId: z.string(),
  storage: pluginInstallStorageSchema.optional(),
});

export type IPluginPanelUpdateStorageVo = z.infer<typeof pluginPanelUpdateStorageVoSchema>;

export const pluginPanelUpdateStorageRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: PLUGIN_PANEL_UPDATE_STORAGE,
  description: 'Update storage of a plugin in a plugin panel',
  request: {
    params: z.object({
      tableId: z.string(),
      pluginPanelId: z.string(),
      pluginInstallId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: pluginPanelUpdateStorageRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Storage updated successfully.',
      content: {
        'application/json': {
          schema: pluginInstallStorageSchema,
        },
      },
    },
  },
  tags: ['plugin-panel'],
});

export const updatePluginPanelStorage = async (
  tableId: string,
  pluginPanelId: string,
  pluginInstallId: string,
  ro: IPluginPanelUpdateStorageRo
) => {
  return axios.patch<IPluginPanelUpdateStorageVo>(
    urlBuilder(PLUGIN_PANEL_UPDATE_STORAGE, { tableId, pluginPanelId, pluginInstallId }),
    ro
  );
};
