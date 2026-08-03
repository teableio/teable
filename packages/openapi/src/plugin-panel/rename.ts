import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_PANEL_RENAME = '/table/{tableId}/plugin-panel/{pluginPanelId}/rename';

export const pluginPanelRenameRoSchema = z.object({
  name: z.string(),
});

export type IPluginPanelRenameRo = z.infer<typeof pluginPanelRenameRoSchema>;

export const pluginPanelRenameVoSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type IPluginPanelRenameVo = z.infer<typeof pluginPanelRenameVoSchema>;

export const pluginPanelRenameRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: PLUGIN_PANEL_RENAME,
  description: 'Rename a plugin panel',
  request: {
    params: z.object({
      tableId: z.string(),
      pluginPanelId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: pluginPanelRenameRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Plugin panel updated successfully.',
      content: {
        'application/json': {
          schema: pluginPanelRenameRoSchema,
        },
      },
    },
  },
  tags: ['plugin-panel'],
});

export const renamePluginPanel = async (
  tableId: string,
  pluginPanelId: string,
  ro: IPluginPanelRenameRo
) => {
  return axios.patch<IPluginPanelRenameVo>(
    urlBuilder(PLUGIN_PANEL_RENAME, { tableId, pluginPanelId }),
    ro
  );
};
