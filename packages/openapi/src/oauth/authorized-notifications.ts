import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const UPDATE_AUTHORIZED_NOTIFICATIONS = '/oauth/client/{clientId}/authorized/notifications';

export const updateAuthorizedNotificationsRoSchema = z.object({
  muted: z.boolean(),
});

export type IUpdateAuthorizedNotificationsRo = z.infer<
  typeof updateAuthorizedNotificationsRoSchema
>;

export const updateAuthorizedNotificationsRoute = registerRoute({
  method: 'patch',
  path: UPDATE_AUTHORIZED_NOTIFICATIONS,
  description:
    'Turn the notifications an authorized OAuth app sends the current user off or back on',
  request: {
    params: z.object({
      clientId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateAuthorizedNotificationsRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated',
    },
  },
  tags: ['oauth'],
});

export const updateAuthorizedNotifications = async (
  clientId: string,
  ro: IUpdateAuthorizedNotificationsRo
) => {
  return axios.patch<void>(urlBuilder(UPDATE_AUTHORIZED_NOTIFICATIONS, { clientId }), ro);
};
