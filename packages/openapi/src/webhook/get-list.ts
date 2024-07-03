import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import type { z } from '../zod';
import { webhookVoSchema } from './get';

export const GET_WEBHOOK_LIST = '{spaceId}/webhook';

export const webhookListVoSchema = webhookVoSchema.array().openapi({
  description: 'The list of webhook',
});

export type IWebhookListVo = z.infer<typeof webhookListVoSchema>;

export const GetWebhookListRoute = registerRoute({
  method: 'get',
  path: GET_WEBHOOK_LIST,
  description: 'Get webhook list',
  request: {},
  responses: {
    200: {
      description: 'Returns the list of webhook',
      content: {
        'application/json': {
          schema: webhookListVoSchema,
        },
      },
    },
  },
  tags: ['webhook'],
});

export const getWebhookList = async (spaceId: string) => {
  return axios.get<IWebhookListVo>(urlBuilder(GET_WEBHOOK_LIST, { spaceId }));
};
