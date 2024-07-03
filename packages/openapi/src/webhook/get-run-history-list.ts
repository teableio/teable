import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { webhookRunHistoryVoSchema } from './get-run-history';

export const GET_WEBHOOK_RUN_HISTORY_LIST = '/webhook/run-history';

export const getWebhookRunHistoryListQuerySchema = z.object({
  cursor: z.string().nullish(),
});

export type IGetWebhookRunHistoryListQuery = z.infer<typeof getWebhookRunHistoryListQuerySchema>;

export const webhookRunHistoryListVoSchema = z.array(webhookRunHistoryVoSchema);
export type IWebhookRunHistoryList = z.infer<typeof webhookRunHistoryListVoSchema>;

export const webhookRunHistoriesVoSchema = z
  .object({
    runHistories: webhookRunHistoryListVoSchema,
    nextCursor: z.string().nullish(),
  })
  .openapi({
    description: 'The list of webhook run history',
  });

export type IWebhookRunHistoriesVo = z.infer<typeof webhookRunHistoriesVoSchema>;

export const GetWebhookRunHistoryListRoute = registerRoute({
  method: 'get',
  path: GET_WEBHOOK_RUN_HISTORY_LIST,
  description: 'Get webhook run history list',
  request: {
    query: getWebhookRunHistoryListQuerySchema,
  },
  responses: {
    200: {
      description: 'Returns the list of webhook run history',
      content: {
        'application/json': {
          schema: webhookRunHistoriesVoSchema,
        },
      },
    },
  },
  tags: ['webhook'],
});

export const getWebhookRunHistoryList = async (query: IGetWebhookRunHistoryListQuery) => {
  return axios.get<IWebhookRunHistoriesVo>(urlBuilder(GET_WEBHOOK_RUN_HISTORY_LIST), {
    params: query,
  });
};
