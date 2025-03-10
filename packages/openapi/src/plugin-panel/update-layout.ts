import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { dashboardLayoutSchema } from '../dashboard/types';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_PANEL_UPDATE_LAYOUT = '/table/{tableId}/plugin-panel/{pluginPanelId}/layout';

export const pluginPanelUpdateLayoutRoSchema = z.object({
  layout: dashboardLayoutSchema,
});

export type IPluginPanelUpdateLayoutRo = z.infer<typeof pluginPanelUpdateLayoutRoSchema>;

export const pluginPanelUpdateLayoutVoSchema = z.object({
  id: z.string(),
  layout: dashboardLayoutSchema,
});

export type IPluginPanelUpdateLayoutVo = z.infer<typeof pluginPanelUpdateLayoutVoSchema>;

export const pluginPanelUpdateLayoutRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: PLUGIN_PANEL_UPDATE_LAYOUT,
  description: 'Update the layout of a plugin panel',
  request: {
    params: z.object({
      tableId: z.string(),
      pluginPanelId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: pluginPanelUpdateLayoutRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'The layout of the plugin panel was updated successfully.',
      content: {
        'application/json': {
          schema: pluginPanelUpdateLayoutVoSchema,
        },
      },
    },
  },
  tags: ['plugin-panel'],
});

export const updatePluginPanelLayout = async (
  tableId: string,
  pluginPanelId: string,
  ro: IPluginPanelUpdateLayoutRo
) => {
  return axios.patch<IPluginPanelUpdateLayoutVo>(
    urlBuilder(PLUGIN_PANEL_UPDATE_LAYOUT, { tableId, pluginPanelId }),
    ro
  );
};
