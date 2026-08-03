import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const VIEW_INSTALL_PLUGIN = '/table/{tableId}/view/plugin';

export const viewInstallPluginRoSchema = z.object({
  name: z.string().optional(),
  pluginId: z.string(),
});

export type IViewInstallPluginRo = z.infer<typeof viewInstallPluginRoSchema>;

export const viewInstallPluginVoSchema = z.object({
  pluginId: z.string(),
  pluginInstallId: z.string(),
  name: z.string(),
  viewId: z.string(),
});

export type IViewInstallPluginVo = z.infer<typeof viewInstallPluginVoSchema>;

export const ViewInstallPluginRoute: RouteConfig = registerRoute({
  method: 'post',
  path: VIEW_INSTALL_PLUGIN,
  description: 'Install a plugin to a view',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: viewInstallPluginRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns data about the installed plugin.',
      content: {
        'application/json': {
          schema: viewInstallPluginVoSchema,
        },
      },
    },
  },
  tags: ['view'],
});

export const installViewPlugin = async (tableId: string, ro: IViewInstallPluginRo) => {
  return axios.post<IViewInstallPluginVo>(urlBuilder(VIEW_INSTALL_PLUGIN, { tableId }), ro);
};
