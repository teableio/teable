import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const OAUTH_GET_LIST = '/oauth/client';

export const oauthGetListVoSchema = z.array(
  z.object({
    clientId: z.string(),
    name: z.string(),
    description: z.string().optional(),
    logo: z.string().url().optional(),
    homepage: z.string().url(),
  })
);

export type OAuthGetListVo = z.infer<typeof oauthGetListVoSchema>;

export const oauthGetListRoute = registerRoute({
  method: 'get',
  path: OAUTH_GET_LIST,
  description: 'Get the list of OAuth applications',
  responses: {
    200: {
      description: 'Returns the list of OAuth applications',
      content: {
        'application/json': {
          schema: oauthGetListVoSchema,
        },
      },
    },
  },
  tags: ['oauth'],
});

export const oauthGetList = async () => {
  return axios.get<OAuthGetListVo>(OAUTH_GET_LIST);
};
