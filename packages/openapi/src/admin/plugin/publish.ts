import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const ADMIN_PLUGIN_PUBLISH = '/admin/plugin/{pluginId}/publish';

export const adminPluginPublishRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: ADMIN_PLUGIN_PUBLISH,
  description: 'Publish a plugin',
  request: {
    params: z.object({
      pluginId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Plugin published successfully.',
    },
  },
  tags: ['admin'],
});

export const publishPlugin = async (pluginId: string) => {
  return axios.patch(urlBuilder(ADMIN_PLUGIN_PUBLISH, { pluginId }));
};
