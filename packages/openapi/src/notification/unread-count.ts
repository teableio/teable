import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const NOTIFICATION_UNREAD_COUNT = '/notifications/unread-count';

export const notificationUnreadCountVoSchema = z.object({
  unreadCount: z.number().nonnegative().int(),
});

export type INotificationUnreadCountVo = z.infer<typeof notificationUnreadCountVoSchema>;

export const NotificationUnreadCountRoute: RouteConfig = registerRoute({
  method: 'get',
  path: NOTIFICATION_UNREAD_COUNT,
  description: 'User notification unread count',
  responses: {
    200: {
      description: 'Successful response, return user notification unread count.',
      content: {
        'application/json': {
          schema: notificationUnreadCountVoSchema,
        },
      },
    },
  },
  tags: ['notification'],
});

export const getNotificationUnreadCount = async () => {
  return axios.get<INotificationUnreadCountVo>(urlBuilder(NOTIFICATION_UNREAD_COUNT));
};
