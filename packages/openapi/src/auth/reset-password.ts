import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { signupPasswordSchema } from './types';

export const RESET_PASSWORD = '/auth/reset-password';

export const resetPasswordRoSchema = z.object({
  password: signupPasswordSchema,
  code: z.string(),
});

export type IResetPasswordRo = z.infer<typeof resetPasswordRoSchema>;

export const resetPasswordRoute = registerRoute({
  method: 'post',
  path: RESET_PASSWORD,
  description: 'Reset password',
  request: {
    body: {
      content: {
        'application/json': {
          schema: resetPasswordRoSchema,
        },
      },
    },
  },
  tags: ['auth'],
  responses: {
    201: {
      description: 'Successfully reset password',
    },
  },
});

export const resetPassword = async (ro: IResetPasswordRo) => {
  return axios.post<void>(RESET_PASSWORD, ro);
};
