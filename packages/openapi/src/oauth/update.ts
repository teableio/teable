import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { oauthCreateRoSchema } from './create';
import { oauthGetVoSchema } from './get';

export const OAUTH_UPDATE = '/oauth/client/{clientId}';

export const oauthUpdateRoSchema = oauthCreateRoSchema;

export type OAuthUpdateRo = z.infer<typeof oauthUpdateRoSchema>;

export const oauthUpdateVoSchema = oauthGetVoSchema;

export type OAuthUpdateVo = z.infer<typeof oauthUpdateVoSchema>;

export const oauthUpdateRoute = registerRoute({
  method: 'put',
  path: OAUTH_UPDATE,
  description: 'Update an OAuth application',
  request: {
    params: z.object({
      clientId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: oauthUpdateVoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns the updated OAuth application',
      content: {
        'application/json': {
          schema: oauthUpdateVoSchema,
        },
      },
    },
  },
  tags: ['oauth'],
});

export const oauthUpdate = async (clientId: string, oauthRo: OAuthUpdateRo) => {
  return axios.put<OAuthUpdateVo>(urlBuilder(OAUTH_UPDATE, { clientId }), oauthRo);
};
