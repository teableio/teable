import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_PANEL_CREATE = '/table/{tableId}/plugin-panel';

export const pluginPanelCreateRoSchema = z.object({
  name: z.string(),
});

export type IPluginPanelCreateRo = z.infer<typeof pluginPanelCreateRoSchema>;

export const pluginPanelCreateVoSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type IPluginPanelCreateVo = z.infer<typeof pluginPanelCreateVoSchema>;

export const pluginPanelCreateRoute: RouteConfig = registerRoute({
  method: 'post',
  path: PLUGIN_PANEL_CREATE,
  description: 'Create a plugin panel',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: pluginPanelCreateRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Plugin panel created successfully.',
      content: {
        'application/json': {
          schema: pluginPanelCreateVoSchema,
        },
      },
    },
  },
  tags: ['plugin-panel'],
});

export const createPluginPanel = async (tableId: string, ro: IPluginPanelCreateRo) => {
  return axios.post<IPluginPanelCreateVo>(urlBuilder(PLUGIN_PANEL_CREATE, { tableId }), ro);
};
