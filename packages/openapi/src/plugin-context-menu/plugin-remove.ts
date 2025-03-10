import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_CONTEXT_MENU_REMOVE = '/table/{tableId}/plugin-context-menu/{pluginInstallId}';

export const pluginContextMenuRemoveRoSchema = z.object({
  pluginContextMenuId: z.string(),
});

export type IPluginContextMenuRemoveRo = z.infer<typeof pluginContextMenuRemoveRoSchema>;

export const pluginContextMenuRemoveRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: PLUGIN_CONTEXT_MENU_REMOVE,
  description: 'Remove a plugin context menu',
  request: {
    params: z.object({
      tableId: z.string(),
      pluginInstallId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Plugin context menu removed successfully.',
    },
  },
  tags: ['plugin-context-menu'],
});

export const removePluginContextMenu = async (tableId: string, pluginInstallId: string) => {
  return axios.delete<void>(urlBuilder(PLUGIN_CONTEXT_MENU_REMOVE, { tableId, pluginInstallId }));
};
