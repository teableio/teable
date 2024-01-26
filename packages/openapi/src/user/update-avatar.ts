import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const UPDATE_USER_AVATAR = '/user/avatar';

export const updateUserAvatarRoSchema = z.object({
  file: z.string().openapi({ format: 'binary' }),
});

export type IUpdateUserAvatarRo = z.infer<typeof updateUserAvatarRoSchema>;

export const UpdateUserAvatarRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_USER_AVATAR,
  description: 'Update user avatar',
  request: {
    body: {
      content: {
        'multipart/form-data': {
          schema: updateUserAvatarRoSchema,
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

export const updateUserAvatar = async (updateUserAvatarRo: IUpdateUserAvatarRo) => {
  return axios.patch<void>(urlBuilder(UPDATE_USER_AVATAR), updateUserAvatarRo);
};
