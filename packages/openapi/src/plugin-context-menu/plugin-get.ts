import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { pluginConfigSchema } from '../plugin/types';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_CONTEXT_MENU_GET = '/table/{tableId}/plugin-context-menu/{pluginInstallId}';

export const pluginContextMenuGetVoSchema = z.object({
  name: z.string(),
  tableId: z.string(),
  pluginId: z.string(),
  pluginInstallId: z.string(),
  positionId: z.string(),
  url: z.string().optional(),
  config: pluginConfigSchema.optional(),
});

export type IPluginContextMenuGetVo = z.infer<typeof pluginContextMenuGetVoSchema>;

export const pluginContextMenuGetRoute: RouteConfig = registerRoute({
  method: 'get',
  path: PLUGIN_CONTEXT_MENU_GET,
  request: {
    params: z.object({
      tableId: z.string(),
      pluginInstallId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns data about the plugin context menu.',
      content: {
        'application/json': {
          schema: pluginContextMenuGetVoSchema,
        },
      },
    },
  },
  tags: ['plugin-context-menu'],
});

export const getPluginContextMenu = async (tableId: string, pluginInstallId: string) => {
  return axios.get<IPluginContextMenuGetVo>(
    urlBuilder(PLUGIN_CONTEXT_MENU_GET, { tableId, pluginInstallId })
  );
};
