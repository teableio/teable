import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const REVOKE_ACCESS = '/oauth/client/{clientId}/revoke-access';

export const revokeAccessRoute = registerRoute({
  method: 'post',
  path: REVOKE_ACCESS,
  request: {
    params: z.object({
      clientId: z.string(),
    }),
  },
  responses: {
    201: {
      description: 'Revoke access permission successfully',
    },
  },
  tags: ['oauth'],
});

export const revokeAccess = async (clientId: string) => {
  return axios.post<void>(urlBuilder(REVOKE_ACCESS, { clientId }));
};
