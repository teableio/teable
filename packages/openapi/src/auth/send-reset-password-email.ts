import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const SEND_RESET_PASSWORD_EMAIL = '/auth/send-reset-password-email';

export const sendResetPasswordEmailRoSchema = z.object({
  email: z.string().email(),
});

export type ISendResetPasswordEmailRo = z.infer<typeof sendResetPasswordEmailRoSchema>;

export const sendResetPasswordEmailRoute = registerRoute({
  method: 'post',
  path: SEND_RESET_PASSWORD_EMAIL,
  description: 'Send reset password email',
  request: {
    body: {
      content: {
        'application/json': {
          schema: sendResetPasswordEmailRoSchema,
        },
      },
    },
  },
  tags: ['auth'],
  responses: {
    201: {
      description: 'Successfully sent reset password email',
    },
  },
});

export const sendResetPasswordEmail = async (ro: ISendResetPasswordEmailRo) => {
  return axios.post<void>(SEND_RESET_PASSWORD_EMAIL, ro);
};
