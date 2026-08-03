import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const OAUTH_GET = '/oauth/client/{clientId}';

export const oauthGetRoSchema = z.object({
  clientId: z.string(),
});

export type OAuthGetRo = z.infer<typeof oauthGetRoSchema>;

export const oauthGetVoSchema = z.object({
  clientId: z.string(),
  name: z.string(),
  secrets: z
    .array(
      z.object({
        id: z.string(),
        secret: z.string(),
        lastUsedTime: z.string().optional(),
      })
    )
    .optional(),
  scopes: z.array(z.string()).optional(),
  logo: z.string().url().optional(),
  homepage: z.string().url(),
  redirectUris: z.array(z.string().url()),
});

export type OAuthGetVo = z.infer<typeof oauthGetVoSchema>;

export const oauthGetRoute = registerRoute({
  method: 'get',
  path: OAUTH_GET,
  description: 'Get the OAuth application',
  request: {
    params: z.object({
      clientId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the OAuth application',
      content: {
        'application/json': {
          schema: oauthGetVoSchema,
        },
      },
    },
  },
  tags: ['oauth'],
});

export const oauthGet = async (clientId: string) => {
  return axios.get<OAuthGetVo>(urlBuilder(OAUTH_GET, { clientId }));
};
