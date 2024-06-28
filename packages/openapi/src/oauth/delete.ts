import { axios } from '../axios';
import { registerRoute } from '../utils';
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

export const deleteOAuth = async (clientId: string) => {
  return axios.delete<void>(OAUTH_DELETE, { params: { clientId } });
};
