import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { pluginInstallStorageSchema } from '../dashboard';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_CONTEXT_MENU_UPDATE_STORAGE =
  '/table/{tableId}/plugin-context-menu/{pluginInstallId}/update-storage';

export const pluginContextMenuUpdateStorageRoSchema = z.object({
  storage: pluginInstallStorageSchema.optional(),
});

export type IPluginContextMenuUpdateStorageRo = z.infer<
  typeof pluginContextMenuUpdateStorageRoSchema
>;

export const pluginContextMenuUpdateStorageVoSchema = z.object({
  tableId: z.string(),
  pluginInstallId: z.string(),
  storage: pluginInstallStorageSchema.optional(),
});

export type IPluginContextMenuUpdateStorageVo = z.infer<
  typeof pluginContextMenuUpdateStorageVoSchema
>;

export const pluginContextMenuUpdateStorageRoute: RouteConfig = registerRoute({
  method: 'put',
  path: PLUGIN_CONTEXT_MENU_UPDATE_STORAGE,
  request: {
    params: z.object({
      tableId: z.string(),
      pluginInstallId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: pluginContextMenuUpdateStorageRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Plugin context menu updated successfully.',
      content: {
        'application/json': {
          schema: pluginContextMenuUpdateStorageVoSchema,
        },
      },
    },
  },
  tags: ['plugin-context-menu'],
});

export const updatePluginContextMenuStorage = async (
  tableId: string,
  pluginInstallId: string,
  ro: IPluginContextMenuUpdateStorageRo
) => {
  return axios.put<IPluginContextMenuUpdateStorageVo>(
    urlBuilder(PLUGIN_CONTEXT_MENU_UPDATE_STORAGE, { tableId, pluginInstallId }),
    ro
  );
};
