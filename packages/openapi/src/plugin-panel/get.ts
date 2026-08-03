import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { dashboardLayoutSchema } from '../dashboard';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_PANEL_GET = '/table/{tableId}/plugin-panel/{pluginPanelId}';

export const pluginPanelPluginItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  positionId: z.string(),
  pluginInstallId: z.string(),
  url: z.string().optional(),
});
export type IPluginPanelPluginItem = z.infer<typeof pluginPanelPluginItemSchema>;

export const pluginPanelGetVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  layout: dashboardLayoutSchema.optional(),
  pluginMap: z.record(z.string(), pluginPanelPluginItemSchema).optional(),
});

export type IPluginPanelGetVo = z.infer<typeof pluginPanelGetVoSchema>;

export const pluginPanelGetRoute: RouteConfig = registerRoute({
  method: 'get',
  path: PLUGIN_PANEL_GET,
  description: 'Get a plugin panel',
  request: {
    params: z.object({
      tableId: z.string(),
      pluginPanelId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Plugin panel retrieved successfully.',
    },
  },
  tags: ['plugin-panel'],
});

export const getPluginPanel = async (tableId: string, pluginPanelId: string) => {
  return axios.get<IPluginPanelGetVo>(urlBuilder(PLUGIN_PANEL_GET, { tableId, pluginPanelId }));
};
