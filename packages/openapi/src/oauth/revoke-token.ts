import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const REVOKE_TOKEN = '/oauth/client/{clientId}/revoke-token';

export const revokeTokenRoute = registerRoute({
  method: 'post',
  path: REVOKE_TOKEN,
  request: {
    params: z.object({
      clientId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Revoke token successfully',
    },
  },
  tags: ['oauth'],
});

export const revokeToken = async (clientId: string) => {
  return axios.post<void>(urlBuilder(REVOKE_TOKEN, { clientId }));
};
