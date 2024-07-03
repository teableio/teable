import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { IWebhookVo } from './get';
import { webhookVoSchema } from './get';
import { ContentType } from './types';

export const CREATE_WEBHOOK = '{spaceId}/webhook';

export const createWebhookRoSchema = z.object({
  spaceId: z.string(),
  baseIds: z.string().array().optional(),
  url: z.string().url(),
  contentType: z.nativeEnum(ContentType),
  secret: z.string().optional(),
  events: z.string().array().min(1),
  isEnabled: z.coerce.boolean(),
});

export type ICreateWebhookRo = z.infer<typeof createWebhookRoSchema>;

export const CreatWebhookRoute = registerRoute({
  method: 'post',
  path: CREATE_WEBHOOK,
  description: 'Create web hook',
  request: {
    body: {
      content: {
        'application/json': {
          schema: createWebhookRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Return web hook',
      content: {
        'application/json': {
          schema: webhookVoSchema,
        },
      },
    },
  },
  tags: ['webhook'],
});

export const createWebhook = async (body: ICreateWebhookRo) => {
  return axios.post<IWebhookVo>(urlBuilder(CREATE_WEBHOOK, { spaceId: body.spaceId }), body);
};
