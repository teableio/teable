import { OAUTH_ACTIONS } from '@teable/core';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { oauthGetVoSchema } from './get';

export const OAUTH_CREATE = '/oauth/client';

export const oauthCreateRoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  homepage: z.string().url(),
  logo: z.string().optional(),
  scopes: z
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .array(z.nativeEnum(OAUTH_ACTIONS as any))
    .transform<string[]>((val) => (val ? Array.from(new Set(val)) : val))
    .optional(),
  redirectUris: z.array(z.string().url()).min(1),
});

export type OAuthCreateRo = z.infer<typeof oauthCreateRoSchema>;
export const oauthCreateVoSchema = oauthGetVoSchema;

export type OAuthCreateVo = z.infer<typeof oauthCreateVoSchema>;

export const oauthCreateRoute = registerRoute({
  method: 'post',
  path: OAUTH_CREATE,
  description: 'Create a new OAuth application',
  request: {
    body: {
      content: {
        'application/json': {
          schema: oauthCreateRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns the created OAuth application',
      content: {
        'application/json': {
          schema: oauthCreateVoSchema,
        },
      },
    },
  },
  tags: ['oauth'],
});

export const oauthCreate = async (oauthRo: OAuthCreateRo) => {
  return axios.post<OAuthCreateVo>(OAUTH_CREATE, oauthRo);
};
