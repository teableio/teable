import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_ACCESS_TOKEN = '/access-token/{id}';

export const deleteAccessRoute = registerRoute({
  method: 'delete',
  path: DELETE_ACCESS_TOKEN,
  description: 'Delete access token',
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Access token deleted.',
    },
  },
  tags: ['access-token'],
});

export const deleteAccessToken = async (id: string) => {
  return axios.delete<void>(urlBuilder(DELETE_ACCESS_TOKEN, { id }));
};
