import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export enum RecurringIntervalType {
  Month = 'month',
  Year = 'year',
}

export enum BillingProductLevel {
  Free = 'free',
  Plus = 'plus',
  Pro = 'pro',
  Enterprise = 'enterprise',
}

export const subscriptionSummaryVoSchema = z.object({
  spaceId: z.string(),
  level: z.nativeEnum(BillingProductLevel),
});

export type ISubscriptionSummaryVo = z.infer<typeof subscriptionSummaryVoSchema>;

export const GET_SUBSCRIPTION_SUMMARY = '/space/{spaceId}/billing/subscription/summary';

export const GetSubscriptionSummaryRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_SUBSCRIPTION_SUMMARY,
  description: 'Retrieves a summary of subscription information for a space',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns a summary of subscription information about a space.',
      content: {
        'application/json': {
          schema: subscriptionSummaryVoSchema,
        },
      },
    },
  },
  tags: ['billing'],
});

export const getSubscriptionSummary = async (spaceId: string) => {
  return axios.get<ISubscriptionSummaryVo>(
    urlBuilder(GET_SUBSCRIPTION_SUMMARY, {
      spaceId,
    })
  );
};
