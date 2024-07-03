import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { ContentType } from './types';

export const GET_WEBHOOK = '/webhook/{webHookId}';

export const webhookVoSchema = z.object({
  id: z.string(),
  url: z.string(),
  contentType: z.nativeEnum(ContentType),
  events: z.string().array().min(1),
  hasSecret: z.boolean(),
  isEnabled: z.boolean(),
  createdTime: z.string(),
  lastModifiedTime: z.string().optional(),
  lastStatus: z.string().optional(),
});

export type IWebhookVo = z.infer<typeof webhookVoSchema>;

export const GetWebhookRoute = registerRoute({
  method: 'get',
  path: GET_WEBHOOK,
  description: 'Get webhook',
  request: {
    params: z.object({
      webHookId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Return webhook',
      content: {
        'application/json': {
          schema: webhookVoSchema,
        },
      },
    },
  },
  tags: ['webhook'],
});

export const getWebhookById = async (webHookId: string) => {
  return axios.get<IWebhookVo>(urlBuilder(GET_WEBHOOK, { webHookId }));
};
