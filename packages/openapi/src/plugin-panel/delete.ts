import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_PANEL_DELETE = '/table/{tableId}/plugin-panel/{pluginPanelId}';

export const pluginPanelDeleteRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: PLUGIN_PANEL_DELETE,
  description: 'Delete a plugin panel',
  request: {
    params: z.object({
      tableId: z.string(),
      pluginPanelId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Plugin panel deleted successfully.',
    },
  },
  tags: ['plugin-panel'],
});

export const deletePluginPanel = async (tableId: string, pluginPanelId: string) => {
  return axios.delete<void>(urlBuilder(PLUGIN_PANEL_DELETE, { tableId, pluginPanelId }));
};
