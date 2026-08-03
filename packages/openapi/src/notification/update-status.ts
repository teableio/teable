import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const UPDATE_NOTIFICATION_STATUS = '/notifications/{notificationId}/status';

export const updateNotifyStatusRoSchema = z.object({
  isRead: z.boolean(),
});

export type IUpdateNotifyStatusRo = z.infer<typeof updateNotifyStatusRoSchema>;

export const UpdateNotificationStatusRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_NOTIFICATION_STATUS,
  description: 'Patch notification status',
  request: {
    params: z.object({
      notificationId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateNotifyStatusRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns successfully patch notification status',
    },
  },
  tags: ['notification'],
});

export const updateNotificationStatus = async (params: {
  notificationId: string;
  updateNotifyStatusRo: IUpdateNotifyStatusRo;
}) => {
  const { notificationId, updateNotifyStatusRo } = params;

  return axios.patch<void>(
    urlBuilder(UPDATE_NOTIFICATION_STATUS, { notificationId }),
    updateNotifyStatusRo
  );
};
