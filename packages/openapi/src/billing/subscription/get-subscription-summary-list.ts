import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { Axios } from 'axios';
import { axios as axiosInstance } from '../../axios';
import { registerRoute } from '../../utils';
import { z } from '../../zod';
import type { ISubscriptionSummaryVo } from './get-subscription-summary';
import { subscriptionSummaryVoSchema } from './get-subscription-summary';

export const GET_SUBSCRIPTION_SUMMARY_LIST = '/billing/subscription/summary';

export const GetSubscriptionSummaryListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_SUBSCRIPTION_SUMMARY_LIST,
  description: 'Retrieves a summary of subscription information across all spaces',
  request: {},
  responses: {
    200: {
      description: 'Returns a summary of subscription information for each space.',
      content: {
        'application/json': {
          schema: z.array(subscriptionSummaryVoSchema),
        },
      },
    },
  },
  tags: ['billing'],
});

export const getSubscriptionSummaryList = async (axios?: Axios) => {
  const theAxios = axios || axiosInstance;
  return theAxios.get<ISubscriptionSummaryVo[]>(GET_SUBSCRIPTION_SUMMARY_LIST);
};
