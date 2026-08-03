import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_CONTEXT_MENU_INSTALL = '/table/{tableId}/plugin-context-menu/install';

export const pluginContextMenuInstallRoSchema = z.object({
  name: z.string().optional(),
  pluginId: z.string(),
});

export type IPluginContextMenuInstallRo = z.infer<typeof pluginContextMenuInstallRoSchema>;

export const pluginContextMenuInstallVoSchema = z.object({
  pluginInstallId: z.string(),
  name: z.string(),
  order: z.number(),
});

export type IPluginContextMenuInstallVo = z.infer<typeof pluginContextMenuInstallVoSchema>;

export const pluginContextMenuInstallRoute: RouteConfig = registerRoute({
  method: 'post',
  path: PLUGIN_CONTEXT_MENU_INSTALL,
  description: 'Install a plugin context menu',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: pluginContextMenuInstallRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Plugin context menu installed successfully.',
      content: {
        'application/json': {
          schema: pluginContextMenuInstallVoSchema,
        },
      },
    },
  },
  tags: ['plugin-context-menu'],
});

export const installPluginContextMenu = async (
  tableId: string,
  ro: IPluginContextMenuInstallRo
) => {
  return axios.post<IPluginContextMenuInstallVo>(
    urlBuilder(PLUGIN_CONTEXT_MENU_INSTALL, { tableId }),
    ro
  );
};
