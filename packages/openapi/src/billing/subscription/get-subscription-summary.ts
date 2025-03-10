import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { AxiosResponse } from 'axios';
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

export enum SubscriptionStatus {
  Active = 'active',
  Canceled = 'canceled',
  Incomplete = 'incomplete',
  IncompleteExpired = 'incomplete_expired',
  Trialing = 'trialing',
  PastDue = 'past_due',
  Unpaid = 'unpaid',
  Paused = 'paused',
  SeatLimitExceeded = 'seat_limit_exceeded',
}

export const subscriptionSummaryVoSchema = z.object({
  spaceId: z.string(),
  status: z.nativeEnum(SubscriptionStatus),
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

export async function getSubscriptionSummary(
  spaceId: string
): Promise<AxiosResponse<ISubscriptionSummaryVo>> {
  return axios.get<ISubscriptionSummaryVo>(
    urlBuilder(GET_SUBSCRIPTION_SUMMARY, {
      spaceId: spaceId,
    })
  );
}
