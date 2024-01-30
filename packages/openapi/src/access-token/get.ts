import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { accessTokenItemSchema } from './types';

export const GET_ACCESS_TOKEN = '/access-token/{id}';

export const getAccessTokenVoSchema = accessTokenItemSchema;

export type GetAccessTokenVo = z.infer<typeof getAccessTokenVoSchema>;

export const getAccessRoute = registerRoute({
  method: 'get',
  path: GET_ACCESS_TOKEN,
  description: 'Get access token',
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns access token.',
      content: {
        'application/json': {
          schema: getAccessTokenVoSchema,
        },
      },
    },
  },
  tags: ['access-token'],
});

export const getAccessToken = async (id: string) => {
  return axios.get<GetAccessTokenVo>(urlBuilder(GET_ACCESS_TOKEN, { id }));
};
