import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { notificationSchema, NotificationStatesEnum } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const NOTIFICATION_LIST = '/notifications';

export const getNotifyListQuerySchema = z.object({
  notifyStates: z.nativeEnum(NotificationStatesEnum),
  cursor: z.string().nullish(),
});

export type IGetNotifyListQuery = z.infer<typeof getNotifyListQuerySchema>;

export const notificationListVoSchema = z.array(notificationSchema);
export type INotificationList = z.infer<typeof notificationListVoSchema>;

export const notificationVoSchema = z.object({
  notifications: notificationListVoSchema,
  nextCursor: z.string().nullish(),
});

export type INotificationVo = z.infer<typeof notificationVoSchema>;

export const NotificationListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: NOTIFICATION_LIST,
  description: 'List a user notification',
  request: {
    query: getNotifyListQuerySchema,
  },
  responses: {
    200: {
      description: 'Successful response, return user notification list.',
      content: {
        'application/json': {
          schema: notificationVoSchema,
        },
      },
    },
  },
  tags: ['notification'],
});

export const getNotificationList = async (query: IGetNotifyListQuery) => {
  return axios.get<INotificationVo>(urlBuilder(NOTIFICATION_LIST), { params: query });
};
