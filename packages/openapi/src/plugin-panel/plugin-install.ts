import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_PANEL_INSTALL = '/table/{tableId}/plugin-panel/{pluginPanelId}/install';

export const pluginPanelInstallRoSchema = z.object({
  name: z.string().optional(),
  pluginId: z.string(),
});

export type IPluginPanelInstallRo = z.infer<typeof pluginPanelInstallRoSchema>;

export const pluginPanelInstallVoSchema = z.object({
  name: z.string(),
  pluginId: z.string(),
  pluginInstallId: z.string(),
});

export type IPluginPanelInstallVo = z.infer<typeof pluginPanelInstallVoSchema>;

export const pluginPanelInstallRoute: RouteConfig = registerRoute({
  method: 'post',
  path: PLUGIN_PANEL_INSTALL,
  description: 'Install a plugin to a table plugin panel',
  request: {
    params: z.object({
      tableId: z.string(),
      pluginPanelId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: pluginPanelInstallRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Plugin installed successfully.',
      content: {
        'application/json': {
          schema: pluginPanelInstallVoSchema,
        },
      },
    },
  },
  tags: ['plugin-panel'],
});

export const installPluginPanel = async (
  tableId: string,
  pluginPanelId: string,
  ro: IPluginPanelInstallRo
) => {
  return axios.post<IPluginPanelInstallVo>(
    urlBuilder(PLUGIN_PANEL_INSTALL, { tableId, pluginPanelId }),
    ro
  );
};
