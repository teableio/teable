import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const UPDATE_ACCESS_TOKEN = '/access-token/{id}';

export const updateAccessTokenRoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  scopes: z.array(z.string()),
  spaceIds: z.array(z.string()).nullable().optional(),
  baseIds: z.array(z.string()).nullable().optional(),
  hasFullAccess: z.boolean().optional(),
});

export type UpdateAccessTokenRo = z.infer<typeof updateAccessTokenRoSchema>;

export const updateAccessTokenVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  scopes: z.array(z.string()),
  spaceIds: z.array(z.string()).optional(),
  baseIds: z.array(z.string()).optional(),
  hasFullAccess: z.boolean().optional(),
});

export type UpdateAccessTokenVo = z.infer<typeof updateAccessTokenVoSchema>;

export const updateAccessTokenRoute = registerRoute({
  method: 'put',
  path: UPDATE_ACCESS_TOKEN,
  description: 'Update access token',
  request: {
    params: z.object({
      id: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateAccessTokenRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns access token.',
      content: {
        'application/json': {
          schema: updateAccessTokenVoSchema,
        },
      },
    },
  },
  tags: ['access-token'],
});

export const updateAccessToken = async (id: string, body: UpdateAccessTokenRo) => {
  return axios.put<UpdateAccessTokenVo>(urlBuilder(UPDATE_ACCESS_TOKEN, { id }), body);
};
