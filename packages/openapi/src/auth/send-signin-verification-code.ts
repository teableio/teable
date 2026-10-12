import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const SEND_SIGNIN_VERIFICATION_CODE = '/auth/send-signin-verification-code';

export const sendSigninVerificationCodeRoSchema = z.object({
  email: z.email().toLowerCase(),
  turnstileToken: z.string().optional(),
});

export type ISendSigninVerificationCodeRo = z.infer<typeof sendSigninVerificationCodeRoSchema>;

export const sendSigninVerificationCodeVoSchema = z.object({
  expiresTime: z.string(),
});

export type ISendSigninVerificationCodeVo = z.infer<typeof sendSigninVerificationCodeVoSchema>;

export const sendSigninVerificationCodeRoute: RouteConfig = registerRoute({
  method: 'post',
  path: SEND_SIGNIN_VERIFICATION_CODE,
  description: 'Send a one-time sign-in verification code to a registered email',
  request: {
    body: {
      content: {
        'application/json': {
          schema: sendSigninVerificationCodeRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Sign-in verification code sent successfully',
      content: {
        'application/json': {
          schema: sendSigninVerificationCodeVoSchema,
        },
      },
    },
  },
  tags: ['auth'],
});

export const sendSigninVerificationCode = (email: string, turnstileToken?: string) =>
  axios.post<ISendSigninVerificationCodeVo>(SEND_SIGNIN_VERIFICATION_CODE, {
    email,
    turnstileToken,
  });
