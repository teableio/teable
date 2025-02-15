import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { createWebhookRoSchema } from './create';
import type { IWebhookVo } from './get';
import { webhookVoSchema } from './get';

export const UPDATE_WEBHOOK = '/webhook/{id}';

export const updateWebhookRoSchema = createWebhookRoSchema;

export type IUpdateWebhookRo = z.infer<typeof updateWebhookRoSchema>;

export const UpdateWebhookRoute = registerRoute({
  method: 'put',
  path: UPDATE_WEBHOOK,
  description: 'Update web hook',
  request: {
    params: z.object({
      id: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateWebhookRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Return the updated web hook',
      content: {
        'application/json': {
          schema: webhookVoSchema,
        },
      },
    },
  },
  tags: ['webhook'],
});

export const updateWebhook = async (id: string, body: IUpdateWebhookRo) => {
  return axios.put<IWebhookVo>(urlBuilder(UPDATE_WEBHOOK, { id }), body);
};
