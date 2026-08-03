import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { pluginGetTokenVoSchema } from './get-token';

export const PLUGIN_REFRESH_TOKEN = '/plugin/{pluginId}/refreshToken';

export const pluginRefreshTokenRoSchema = z.object({
  refreshToken: z.string(),
  secret: z.string(),
});

export type IPluginRefreshTokenRo = z.infer<typeof pluginRefreshTokenRoSchema>;

export const pluginRefreshTokenVoSchema = pluginGetTokenVoSchema;

export type IPluginRefreshTokenVo = z.infer<typeof pluginRefreshTokenVoSchema>;

export const PluginRefreshTokenRoute: RouteConfig = registerRoute({
  method: 'post',
  path: PLUGIN_REFRESH_TOKEN,
  description: 'Refresh a token',
  request: {
    params: z.object({
      pluginId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: pluginRefreshTokenRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns token.',
      content: {
        'application/json': {
          schema: pluginRefreshTokenVoSchema,
        },
      },
    },
  },
  tags: ['plugin'],
});

export const pluginRefreshToken = async (pluginId: string, ro: IPluginRefreshTokenRo) => {
  return axios.post<IPluginRefreshTokenVo>(urlBuilder(PLUGIN_REFRESH_TOKEN, { pluginId }), ro);
};
