import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_PANEL_LIST = '/table/{tableId}/plugin-panel';

export const pluginPanelListVoSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
  })
);

export type IPluginPanelListVo = z.infer<typeof pluginPanelListVoSchema>;

export const pluginPanelListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: PLUGIN_PANEL_LIST,
  description: 'Get all plugin panels',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Plugin panels retrieved successfully.',
      content: {
        'application/json': {
          schema: pluginPanelListVoSchema,
        },
      },
    },
  },
  tags: ['plugin-panel'],
});

export const listPluginPanels = async (tableId: string) => {
  return axios.get<IPluginPanelListVo>(urlBuilder(PLUGIN_PANEL_LIST, { tableId }));
};
