import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const LIST_ACCESS_TOKEN = '/access-token';

export const listAccessTokenVoSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    scopes: z.array(z.string()),
    spaceIds: z.array(z.string()).nullable().optional(),
    baseIds: z.array(z.string()).nullable().optional(),
    expiredTime: z.string(),
    createdTime: z.string(),
    lastUsedTime: z.string().optional(),
  })
);

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
