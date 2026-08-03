import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLUGIN_GET_AUTH_CODE = '/plugin/{pluginId}/authCode';

export const pluginGetAuthCodeRoSchema = z.object({
  baseId: z.string(),
});

export const pluginGetAuthCodeRouter = registerRoute({
  method: 'post',
  path: PLUGIN_GET_AUTH_CODE,
  description: 'Get an auth code',
  request: {
    params: z.object({
      pluginId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: pluginGetAuthCodeRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns auth code.',
      content: {
        'application/json': {
          schema: z.object({
            code: z.string(),
          }),
        },
      },
    },
  },
  tags: ['plugin'],
});

export const pluginGetAuthCode = async (pluginId: string, baseId: string) => {
  return axios.post<string>(urlBuilder(PLUGIN_GET_AUTH_CODE, { pluginId }), { baseId });
};
