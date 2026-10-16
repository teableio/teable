import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DECISION_INFO_GET = '/oauth/decision/{transactionId}';

export const decisionInfoGetVoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  homepage: z.string().url().optional(),
  logo: z.string().url().optional(),
  scopes: z.array(z.string()).optional(),
  // the client registered itself (RFC 7591); there is no developer behind it
  dynamicRegistration: z.boolean().optional(),
  // where the authorization code will be sent after approval
  redirectUri: z.string().optional(),
});

export type DecisionInfoGetVo = z.infer<typeof decisionInfoGetVoSchema>;

export const decisionInfoGetRoute = registerRoute({
  method: 'get',
  path: DECISION_INFO_GET,
  description: 'Get the OAuth application',
  request: {
    params: z.object({
      transactionId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the OAuth application',
      content: {
        'application/json': {
          schema: decisionInfoGetVoSchema,
        },
      },
    },
  },
  tags: ['oauth'],
});

export const decisionInfoGet = async (transactionId: string) => {
  return axios.get<DecisionInfoGetVo>(urlBuilder(DECISION_INFO_GET, { transactionId }));
};
