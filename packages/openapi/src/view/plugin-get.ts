import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { pluginInstallStorageSchema } from '../dashboard';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_VIEW_INSTALL_PLUGIN = '/table/{tableId}/view/{viewId}/plugin';

export const getViewInstallPluginVoSchema = z.object({
  pluginId: z.string(),
  pluginInstallId: z.string(),
  baseId: z.string(),
  name: z.string(),
  url: z.string().optional(),
  storage: pluginInstallStorageSchema.optional(),
});

export type IGetViewInstallPluginVo = z.infer<typeof getViewInstallPluginVoSchema>;

export const GetViewInstallPluginRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_VIEW_INSTALL_PLUGIN,
  description: 'Get a view install plugin by id',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns data about the view install plugin.',
      content: {
        'application/json': {
          schema: getViewInstallPluginVoSchema,
        },
      },
    },
  },
  tags: ['view'],
});

export const getViewInstallPlugin = async (tableId: string, viewId: string) => {
  return axios.get<IGetViewInstallPluginVo>(
    urlBuilder(GET_VIEW_INSTALL_PLUGIN, { tableId, viewId })
  );
};
