import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const UPDATE_UNSUBSCRIBE = '/unsubscribe/{token}';

export const updateSubscriptionRoSchema = z.object({
  subscriptionStatus: z.boolean(),
});

export type IUpdateSubscriptionRo = z.infer<typeof updateSubscriptionRoSchema>;

export const updateSubscriptionRoute: RouteConfig = registerRoute({
  method: 'post',
  path: UPDATE_UNSUBSCRIBE,
  description: 'Update subscription status',
  request: {
    params: z.object({
      token: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateSubscriptionRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successful response',
      content: {
        'application/json': {
          schema: z.boolean(),
        },
      },
    },
  },
  tags: ['unsubscribe'],
});

export const updateSubscription = async (token: string, ro: IUpdateSubscriptionRo) => {
  return axios.post<boolean>(urlBuilder(UPDATE_UNSUBSCRIBE, { token }), ro);
};
