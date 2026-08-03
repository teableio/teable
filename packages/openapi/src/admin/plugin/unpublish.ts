import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const ADMIN_PLUGIN_UNPUBLISH = '/admin/plugin/{pluginId}/unpublish';

export const adminUnpublishPluginRouter: RouteConfig = registerRoute({
  method: 'patch',
  description: 'Admin unpublish a plugin',
  path: ADMIN_PLUGIN_UNPUBLISH,
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
  tags: ['admin'],
});

export const adminUnpublishPlugin = async (pluginId: string) => {
  return axios.patch(urlBuilder(ADMIN_PLUGIN_UNPUBLISH, { pluginId }));
};
