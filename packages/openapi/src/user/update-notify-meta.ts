import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const UPDATE_USER_NOTIFY_META = '/user/notify-meta';

export const userNotifyMetaSchema = z.object({
  email: z.boolean().optional(),
});

export type IUserNotifyMeta = z.infer<typeof userNotifyMetaSchema>;

export const UpdateUserNotifyMetaRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_USER_NOTIFY_META,
  description: 'Update user notification meta',
  request: {
    body: {
      content: {
        'application/json': {
          schema: userNotifyMetaSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully update.',
    },
  },
  tags: ['user'],
});

export const updateUserNotifyMeta = async (updateUserNotifyMetaRo: IUserNotifyMeta) => {
  return axios.patch<void>(urlBuilder(UPDATE_USER_NOTIFY_META), updateUserNotifyMetaRo);
};
