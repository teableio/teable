import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_PANEL_REMOVE =
  '/table/{tableId}/plugin-panel/{pluginPanelId}/plugin/{pluginInstallId}';

export const pluginPanelRemoveRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: PLUGIN_PANEL_REMOVE,
  description: 'Remove a plugin from a plugin panel',
  request: {
    params: z.object({
      tableId: z.string(),
      pluginPanelId: z.string(),
      pluginInstallId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Plugin removed from plugin panel successfully.',
    },
  },
  tags: ['plugin-panel'],
});

export const removePluginPanelPlugin = async (
  tableId: string,
  pluginPanelId: string,
  pluginInstallId: string
) => {
  return axios.delete<void>(
    urlBuilder(PLUGIN_PANEL_REMOVE, { tableId, pluginPanelId, pluginInstallId })
  );
};
