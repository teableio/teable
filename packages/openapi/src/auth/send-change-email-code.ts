import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const SEND_CHANGE_EMAIL_CODE = '/auth/send-change-email-code';

export const sendChangeEmailCodeRoSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});
export type ISendChangeEmailCodeRo = z.infer<typeof sendChangeEmailCodeRoSchema>;

export const sendChangeEmailCodeVoSchema = z.object({
  token: z.string(),
});

export type ISendChangeEmailCodeVo = z.infer<typeof sendChangeEmailCodeVoSchema>;

export const SendChangeEmailCodeRoute: RouteConfig = registerRoute({
  method: 'post',
  path: SEND_CHANGE_EMAIL_CODE,
  description: 'Send change email code',
  request: {
    body: {
      content: {
        'application/json': {
          schema: sendChangeEmailCodeRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Send change email code successfully',
      content: {
        'application/json': {
          schema: sendChangeEmailCodeVoSchema,
        },
      },
    },
  },
  tags: ['auth'],
});

export const sendChangeEmailCode = async (ro: ISendChangeEmailCodeRo) => {
  return axios.post<ISendChangeEmailCodeVo>(SEND_CHANGE_EMAIL_CODE, ro);
};
