import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const REFRESH_ACCESS_TOKEN = '/access-token/{id}/refresh';

export const refreshAccessTokenRoSchema = z
  .object({
    expiredTime: z.string(),
  })
  .optional();

export type RefreshAccessTokenRo = z.infer<typeof refreshAccessTokenRoSchema>;

export const refreshAccessTokenVoSchema = z.object({
  id: z.string(),
  expiredTime: z.string(),
  token: z.string(),
});

export type RefreshAccessTokenVo = z.infer<typeof refreshAccessTokenVoSchema>;

export const accessTokenRoute = registerRoute({
  method: 'post',
  path: REFRESH_ACCESS_TOKEN,
  description: 'Refresh access token',
  request: {
    params: z.object({
      id: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: refreshAccessTokenRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns access token.',
      content: {
        'application/json': {
          schema: refreshAccessTokenVoSchema,
        },
      },
    },
  },
  tags: ['access-token'],
});

export const refreshAccessToken = async (id: string, body?: RefreshAccessTokenRo) => {
  return axios.post<RefreshAccessTokenVo>(urlBuilder(REFRESH_ACCESS_TOKEN, { id }), body);
};
