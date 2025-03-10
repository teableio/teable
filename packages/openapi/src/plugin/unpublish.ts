import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const UNPUBLISH_PLUGIN = '/plugin/{pluginId}/unpublish';

export const unpublishPluginRouter: RouteConfig = registerRoute({
  method: 'patch',
  path: UNPUBLISH_PLUGIN,
  request: {
    params: z.object({
      pluginId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Plugin unpublished successfully.',
    },
  },
  tags: ['plugin'],
});

export const unpublishPlugin = async (pluginId: string) => {
  return axios.patch(urlBuilder(UNPUBLISH_PLUGIN, { pluginId }));
};
