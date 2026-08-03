import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const UPDATE_USER_NAME = '/user/name';

export const USER_NAME_MAX_LENGTH = 100;

export const updateUserNameRoSchema = z.object({
  name: z.string().min(1).max(USER_NAME_MAX_LENGTH),
});

export type IUpdateUserNameRo = z.infer<typeof updateUserNameRoSchema>;

export const UpdateUserNameRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_USER_NAME,
  description: 'Update user name',
  request: {
    body: {
      content: {
        'application/json': {
          schema: updateUserNameRoSchema,
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

export const updateUserName = async (updateUserNameRo: IUpdateUserNameRo) => {
  return axios.patch<void>(UPDATE_USER_NAME, updateUserNameRo);
};
