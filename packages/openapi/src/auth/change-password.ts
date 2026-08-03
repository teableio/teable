import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { passwordSchema, signupPasswordSchema } from './types';

export const CHANGE_PASSWORD = '/auth/change-password';

export const changePasswordRoSchema = z.object({
  password: passwordSchema,
  newPassword: signupPasswordSchema,
});

export type IChangePasswordRo = z.infer<typeof changePasswordRoSchema>;

export const ChangePasswordRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: CHANGE_PASSWORD,
  description: 'Change password',
  request: {
    body: {
      content: {
        'application/json': {
          schema: changePasswordRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Change password successfully',
    },
  },
  tags: ['auth'],
});

export const changePassword = async (body: IChangePasswordRo) => {
  return axios.patch<void>(CHANGE_PASSWORD, body);
};
