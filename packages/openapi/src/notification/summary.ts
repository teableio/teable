import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { notificationListVoSchema } from './get-list';

export const NOTIFICATION_SUMMARY = '/notifications/summary';

export const notificationSummaryVoSchema = z.object({
  unreadCount: z.number().nonnegative().int(),
  criticalAdminNotices: notificationListVoSchema.meta({
    description: 'The first page of unread critical admin notices',
  }),
  unreadInvites: notificationListVoSchema.meta({
    description: 'The first page of unread collaborator invites',
  }),
});

export type INotificationSummaryVo = z.infer<typeof notificationSummaryVoSchema>;

export const NotificationSummaryRoute: RouteConfig = registerRoute({
  method: 'get',
  path: NOTIFICATION_SUMMARY,
  description:
    'User notification unread count, with the unread critical admin notices and collaborator invites surfaced outside the notification list',
  responses: {
    200: {
      description: 'Successful response, return user notification summary.',
      content: {
        'application/json': {
          schema: notificationSummaryVoSchema,
        },
      },
    },
  },
  tags: ['notification'],
});

export const getNotificationSummary = async () => {
  return axios.get<INotificationSummaryVo>(urlBuilder(NOTIFICATION_SUMMARY));
};
