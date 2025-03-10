import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
export const PLUGIN_CONTEXT_MENU_GET_LIST = '/table/{tableId}/plugin-context-menu';

export const pluginContextMenuGetItemSchema = z.object({
  pluginInstallId: z.string(),
  name: z.string(),
  pluginId: z.string(),
  logo: z.string(),
  order: z.number(),
});

export type IPluginContextMenuGetItem = z.infer<typeof pluginContextMenuGetItemSchema>;

export const getPluginContextMenuListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: PLUGIN_CONTEXT_MENU_GET_LIST,
  request: {
    params: z.object({
      tableId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns a list of plugins',
      content: {
        'application/json': {
          schema: z.array(pluginContextMenuGetItemSchema),
        },
      },
    },
  },
  tags: ['plugin-context-menu'],
});

export const getPluginContextMenuList = async (tableId: string) => {
  return axios.get<IPluginContextMenuGetItem[]>(
    urlBuilder(PLUGIN_CONTEXT_MENU_GET_LIST, { tableId })
  );
};
