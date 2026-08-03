import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_PANEL_PLUGIN_RENAME =
  '/table/{tableId}/plugin-panel/{pluginPanelId}/plugin/{pluginInstallId}/rename';

export const pluginPanelPluginRenameRoSchema = z.object({
  name: z.string(),
});

export type IPluginPanelPluginRenameRo = z.infer<typeof pluginPanelPluginRenameRoSchema>;

export const pluginPanelPluginRenameVoSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type IPluginPanelPluginRenameVo = z.infer<typeof pluginPanelPluginRenameVoSchema>;

export const pluginPanelPluginRenameRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: PLUGIN_PANEL_PLUGIN_RENAME,
  description: 'Rename a plugin in a plugin panel',
  request: {
    params: z.object({
      tableId: z.string(),
      pluginPanelId: z.string(),
      pluginInstallId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: pluginPanelPluginRenameRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Plugin renamed successfully.',
      content: {
        'application/json': {
          schema: pluginPanelPluginRenameVoSchema,
        },
      },
    },
  },
  tags: ['plugin-panel'],
});

export const renamePluginPanelPlugin = async (
  tableId: string,
  pluginPanelId: string,
  pluginInstallId: string,
  name: string
) => {
  return axios.patch<IPluginPanelPluginRenameVo>(
    urlBuilder(PLUGIN_PANEL_PLUGIN_RENAME, { tableId, pluginPanelId, pluginInstallId }),
    {
      name,
    }
  );
};
