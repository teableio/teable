import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const OAUTH_DELETE = '/oauth/client/{clientId}';

export const deleteOauthRoute = registerRoute({
  method: 'delete',
  path: OAUTH_DELETE,
  description: 'Delete an OAuth application',
  request: {
    params: z.object({
      clientId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'OAuth application deleted',
    },
  },
  tags: ['oauth'],
});

export const oauthDelete = async (clientId: string) => {
  return axios.delete<void>(urlBuilder(OAUTH_DELETE, { clientId }));
};
