import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const SEND_SIGNUP_VERIFICATION_CODE = '/auth/send-signup-verification-code';

export const sendSignupVerificationCodeRoSchema = z.object({
  email: z.string().email(),
  turnstileToken: z.string().optional(),
});

export type ISendSignupVerificationCodeRo = z.infer<typeof sendSignupVerificationCodeRoSchema>;

export const sendSignupVerificationCodeVoSchema = z.object({
  token: z.string(),
  expiresTime: z.string(),
});

export type ISendSignupVerificationCodeVo = z.infer<typeof sendSignupVerificationCodeVoSchema>;

export const sendSignupVerificationCodeRoute: RouteConfig = registerRoute({
  method: 'post',
  path: SEND_SIGNUP_VERIFICATION_CODE,
  description: 'Send signup verification code',
  request: {
    body: {
      content: {
        'application/json': {
          schema: sendSignupVerificationCodeRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Resend signup verification code successfully',
      content: {
        'application/json': {
          schema: sendSignupVerificationCodeVoSchema,
        },
      },
    },
  },
  tags: ['auth'],
});

export const sendSignupVerificationCode = (email: string, turnstileToken?: string) =>
  axios.post<ISendSignupVerificationCodeVo>(SEND_SIGNUP_VERIFICATION_CODE, {
    email,
    turnstileToken,
  });
