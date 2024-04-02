import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { accessTokenItemSchema } from './types';

export const LIST_ACCESS_TOKEN = '/access-token';

export const listAccessTokenVoSchema = z.array(accessTokenItemSchema);

export type ListAccessTokenVo = z.infer<typeof listAccessTokenVoSchema>;

export const listAccessRoute = registerRoute({
  method: 'get',
  path: LIST_ACCESS_TOKEN,
  description: 'List access token',
  request: {},
  responses: {
    200: {
      description: 'Returns access token.',
      content: {
        'application/json': {
          schema: listAccessTokenVoSchema,
        },
      },
    },
  },
  tags: ['access-token'],
});

export const listAccessToken = async () => {
  return axios.get<ListAccessTokenVo>(LIST_ACCESS_TOKEN);
};
