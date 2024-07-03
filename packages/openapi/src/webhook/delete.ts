import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_WEBHOOK = '{spaceId}/webhook/{webhookId}';

export const DeleteWebhookRoute = registerRoute({
  method: 'delete',
  path: DELETE_WEBHOOK,
  description: 'Delete web hook',
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Deleted successfully',
    },
  },
  tags: ['webhook'],
});

export const deleteWebhook = async ({
  spaceId,
  webhookId,
}: {
  spaceId: string;
  webhookId: string;
}) => {
  return axios.delete<void>(urlBuilder(DELETE_WEBHOOK, { spaceId, webhookId }));
};
