import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';

export const NOTIFICATION_READ_ALL = '/notifications/read-all';

export const NotificationReadALlRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: NOTIFICATION_READ_ALL,
  description: 'mark all notifications as read',
  responses: {
    200: {
      description: 'Returns successfully',
    },
  },
  tags: ['notification'],
});

export const notificationReadAll = async () => {
  return axios.patch<void>(urlBuilder(NOTIFICATION_READ_ALL));
};
