import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_SUBMIT = '/plugin/{pluginId}/submit';

export const pluginSubmitRouter: RouteConfig = registerRoute({
  method: 'patch',
  path: PLUGIN_SUBMIT,
  description: 'Submit a plugin',
  request: {
    params: z.object({
      pluginId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Plugin submitted successfully.',
    },
  },
  tags: ['plugin'],
});

export const submitPlugin = async (pluginId: string) => {
  return axios.patch(urlBuilder(PLUGIN_SUBMIT, { pluginId }));
};
