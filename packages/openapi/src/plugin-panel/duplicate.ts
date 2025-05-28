import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_PlUGIN_PANEL_DUPLICATE =
  '/table/{tableId}/plugin-panel/{pluginPanelId}/duplicate';

export const duplicatePluginPanelRoSchema = z.object({
  name: z.string().optional(),
});

export type IDuplicatePluginPanelRo = z.infer<typeof duplicatePluginPanelRoSchema>;

export const duplicatePluginPanelRoute: RouteConfig = registerRoute({
  method: 'post',
  path: PLUGIN_PlUGIN_PANEL_DUPLICATE,
  description: 'Duplicate a plugin panel',
  summary: 'Duplicate a plugin panel',
  request: {
    params: z.object({
      baseId: z.string(),
      id: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the duplicated plugin panel info.',
      content: {
        'application/json': {
          schema: z.object({
            id: z.string(),
            name: z.string(),
          }),
        },
      },
    },
  },
  tags: ['plugin-panel'],
});

export const duplicatePluginPanel = async (
  tableId: string,
  pluginPanelId: string,
  duplicatePluginPanelRo: IDuplicatePluginPanelRo
) => {
  return axios.post<{ id: string; name: string }>(
    urlBuilder(PLUGIN_PlUGIN_PANEL_DUPLICATE, { tableId, pluginPanelId }),
    duplicatePluginPanelRo
  );
};
