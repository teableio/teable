import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_REGENERATE_SECRET = '/plugin/{id}/regenerate-secret';

export const pluginRegenerateSecretRoSchema = z.object({
  id: z.string(),
});

export type IPluginRegenerateSecretRo = z.infer<typeof pluginRegenerateSecretRoSchema>;

export const pluginRegenerateSecretVoSchema = z.object({
  id: z.string(),
  secret: z.string(),
});

export type IPluginRegenerateSecretVo = z.infer<typeof pluginRegenerateSecretVoSchema>;

export const pluginRegenerateSecretRoute: RouteConfig = registerRoute({
  method: 'post',
  path: PLUGIN_REGENERATE_SECRET,
  description: 'Regenerate a plugin secret',
  request: {
    params: pluginRegenerateSecretRoSchema,
  },
  responses: {
    201: {
      description: 'Returns data about the plugin.',
      content: {
        'application/json': {
          schema: pluginRegenerateSecretVoSchema,
        },
      },
    },
  },
  tags: ['plugin'],
});

export const pluginRegenerateSecret = async (id: string) => {
  return axios.post<IPluginRegenerateSecretVo>(urlBuilder(PLUGIN_REGENERATE_SECRET, { id }));
};
