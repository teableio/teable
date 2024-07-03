import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_WEBHOOK_RUN_HISTORY = '/webhook/run-history/{runHistoryId}';

export const webhookRunHistoryVoSchema = z.object({
  id: z.string(),
  webhookId: z.string(),
  event: z.string(),
  status: z.string(),
  request: z.unknown(),
  response: z.unknown(),
  createdTime: z.string(),
  finishedTime: z.string().optional(),
});

export type IWebhookRunHistoryVo = z.infer<typeof webhookRunHistoryVoSchema>;

export const GetWebhookRunHistoryRoute = registerRoute({
  method: 'get',
  path: GET_WEBHOOK_RUN_HISTORY,
  description: 'Get webhook run history by id',
  request: {
    params: z.object({
      runHistoryId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Return the webhook run history by id',
      content: {
        'application/json': {
          schema: webhookRunHistoryVoSchema,
        },
      },
    },
  },
  tags: ['webhook'],
});

export const getWebhookRunHistoryById = async (runHistoryId: string) => {
  return axios.get<IWebhookRunHistoryVo>(urlBuilder(GET_WEBHOOK_RUN_HISTORY, { runHistoryId }));
};
