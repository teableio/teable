import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { pluginInstallStorageSchema } from '../dashboard';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_CONTEXT_MENU_GET_STORAGE =
  '/table/{tableId}/plugin-context-menu/{pluginInstallId}/storage';

export const pluginContextMenuGetStorageVoSchema = z.object({
  name: z.string(),
  tableId: z.string(),
  pluginId: z.string(),
  pluginInstallId: z.string(),
  storage: pluginInstallStorageSchema,
});

export type IPluginContextMenuGetStorageVo = z.infer<typeof pluginContextMenuGetStorageVoSchema>;

export const pluginContextMenuGetStorageRoute: RouteConfig = registerRoute({
  method: 'get',
  path: PLUGIN_CONTEXT_MENU_GET_STORAGE,
  request: {
    params: z.object({
      tableId: z.string(),
      pluginInstallId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Plugin context menu storage retrieved successfully.',
      content: {
        'application/json': {
          schema: pluginContextMenuGetStorageVoSchema,
        },
      },
    },
  },
  tags: ['plugin-context-menu'],
});

export const getPluginContextMenuStorage = async (tableId: string, pluginInstallId: string) => {
  return axios.get<IPluginContextMenuGetStorageVo>(
    urlBuilder(PLUGIN_CONTEXT_MENU_GET_STORAGE, { tableId, pluginInstallId })
  );
};
