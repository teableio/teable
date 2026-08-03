import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_CONTEXT_MENU_RENAME =
  '/table/{tableId}/plugin-context-menu/{pluginInstallId}/rename';

export const pluginContextMenuRenameRoSchema = z.object({
  name: z.string(),
});

export type IPluginContextMenuRenameRo = z.infer<typeof pluginContextMenuRenameRoSchema>;

export const pluginContextMenuRenameVoSchema = z.object({
  pluginInstallId: z.string(),
  name: z.string(),
});

export type IPluginContextMenuRenameVo = z.infer<typeof pluginContextMenuRenameVoSchema>;

export const pluginContextMenuRenameRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: PLUGIN_CONTEXT_MENU_RENAME,
  description: 'Rename a plugin context menu',
  request: {
    params: z.object({
      tableId: z.string(),
      pluginInstallId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: pluginContextMenuRenameRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Plugin context menu renamed successfully.',
    },
  },
  tags: ['plugin-context-menu'],
});

export const renamePluginContextMenu = async (
  tableId: string,
  pluginInstallId: string,
  ro: IPluginContextMenuRenameRo
) => {
  return axios.patch<IPluginContextMenuRenameVo>(
    urlBuilder(PLUGIN_CONTEXT_MENU_RENAME, { tableId, pluginInstallId }),
    ro
  );
};
