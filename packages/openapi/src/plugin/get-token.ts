import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_GET_TOKEN = '/plugin/{pluginId}/token';

export const pluginGetTokenRoSchema = z.object({
  baseId: z.string(),
  secret: z.string(),
  scopes: z.array(z.string()),
  authCode: z.string(),
});

export type IPluginGetTokenRo = z.infer<typeof pluginGetTokenRoSchema>;

export const pluginGetTokenVoSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  scopes: z.array(z.string()),
  expiresIn: z.number(),
  refreshExpiresIn: z.number(),
});

export type IPluginGetTokenVo = z.infer<typeof pluginGetTokenVoSchema>;

export const PluginGetTokenRoute: RouteConfig = registerRoute({
  method: 'get',
  path: PLUGIN_GET_TOKEN,
  description: 'Get a token',
  request: {
    params: z.object({
      pluginId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: pluginGetTokenRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns token.',
      content: {
        'application/json': {
          schema: pluginGetTokenVoSchema,
        },
      },
    },
  },
  tags: ['plugin'],
});

export const pluginGetToken = async (pluginId: string, ro: IPluginGetTokenRo) => {
  return axios.post<IPluginGetTokenVo>(urlBuilder(PLUGIN_GET_TOKEN, { pluginId }), ro);
};
