import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const UPDATE_USER_AVATAR = '/user/updateAvatar';

export const updateUserAvatarRoSchema = z.object({
  avatar: z.string(),
});

export type IUpdateUserAvatarRo = z.infer<typeof updateUserAvatarRoSchema>;

export const UpdateUserAvatarRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_USER_AVATAR,
  description: 'Update user avatar',
  request: {
    body: {
      content: {
        'application/json': {
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

export const updateUserAvatar = async (params: { updateUserAvatarRo: IUpdateUserAvatarRo }) => {
  const { updateUserAvatarRo } = params;

  return axios.patch<void>(urlBuilder(UPDATE_USER_AVATAR), updateUserAvatarRo);
};
