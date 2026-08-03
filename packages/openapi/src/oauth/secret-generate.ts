import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const OAUTH_SECRET_GENERATE = '/oauth/client/{clientId}/secret';

export const generateOAuthSecretVoSchema = z.object({
  id: z.string(),
  secret: z.string(),
  maskedSecret: z.string(),
  lastUsedTime: z.string().optional(),
});

export type GenerateOAuthSecretVo = z.infer<typeof generateOAuthSecretVoSchema>;

export const generateOAuthSecretRoute = registerRoute({
  method: 'post',
  path: OAUTH_SECRET_GENERATE,
  description: 'Generate a new OAuth secret',
  request: {
    params: z.object({
      clientId: z.string(),
    }),
  },
  responses: {
    201: {
      description: 'Returns the generated OAuth secret',
      content: {
        'application/json': {
          schema: generateOAuthSecretVoSchema,
        },
      },
    },
  },
  tags: ['oauth'],
});

export const generateOAuthSecret = async (clientId: string) => {
  return axios.post<GenerateOAuthSecretVo>(urlBuilder(OAUTH_SECRET_GENERATE, { clientId }));
};
