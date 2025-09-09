import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { pluginInstallStorageSchema } from '../dashboard/types';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_PANEL_PLUGIN_GET =
  '/table/{tableId}/plugin-panel/{pluginPanelId}/plugin/{pluginInstallId}';

export const pluginPanelPluginGetRoSchema = z.object({
  tableId: z.string(),
  pluginPanelId: z.string(),
  pluginId: z.string(),
});

export const pluginPanelPluginGetVoSchema = z.object({
  baseId: z.string(),
  name: z.string(),
  tableId: z.string(),
  pluginId: z.string(),
  pluginInstallId: z.string(),
  storage: pluginInstallStorageSchema.optional(),
});

export type IPluginPanelPluginGetVo = z.infer<typeof pluginPanelPluginGetVoSchema>;

export const pluginPanelPluginGetRoute: RouteConfig = registerRoute({
  method: 'get',
  path: PLUGIN_PANEL_PLUGIN_GET,
  description: 'Get a plugin in plugin panel',
  request: {
    params: pluginPanelPluginGetRoSchema,
  },
  responses: {
    200: {
      description: 'Returns data about the plugin.',
      content: {
        'application/json': {
          schema: pluginPanelPluginGetVoSchema,
        },
      },
    },
  },
  tags: ['plugin-panel'],
});

export const getPluginPanelPlugin = (
  tableId: string,
  pluginPanelId: string,
  pluginInstallId: string
) => {
  return axios.get<IPluginPanelPluginGetVo>(
    urlBuilder(PLUGIN_PANEL_PLUGIN_GET, { tableId, pluginPanelId, pluginInstallId })
  );
};
