import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const OAUTH_SECRET_DELETE = '/oauth/client/{clientId}/secret/{secretId}';

export const deleteOauthSecretRoute = registerRoute({
  method: 'delete',
  path: OAUTH_SECRET_DELETE,
  description: 'Delete the OAuth secret',
  request: {
    params: z.object({
      secretId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'OAuth secret deleted',
    },
  },
  tags: ['oauth'],
});

export const deleteOAuthSecret = async (clientId: string, secretId: string) => {
  return axios.delete<void>(urlBuilder(OAUTH_SECRET_DELETE, { clientId, secretId }));
};
