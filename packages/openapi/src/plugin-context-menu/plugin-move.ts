import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_CONTEXT_MENU_MOVE =
  '/table/{tableId}/plugin-context-menu/{pluginInstallId}/move';

export const pluginContextMenuMoveRoSchema = z.object({
  anchorId: z.string(),
  position: z.enum(['before', 'after']),
});

export type IPluginContextMenuMoveRo = z.infer<typeof pluginContextMenuMoveRoSchema>;

export const pluginContextMenuMoveRoute: RouteConfig = registerRoute({
  method: 'put',
  path: PLUGIN_CONTEXT_MENU_MOVE,
  request: {
    params: z.object({
      tableId: z.string(),
      pluginInstallId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: pluginContextMenuMoveRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Plugin context menu moved successfully.',
    },
  },
  tags: ['plugin-context-menu'],
});

export const movePluginContextMenu = async (
  tableId: string,
  pluginInstallId: string,
  ro: IPluginContextMenuMoveRo
) => {
  return axios.put<void>(urlBuilder(PLUGIN_CONTEXT_MENU_MOVE, { tableId, pluginInstallId }), ro);
};
