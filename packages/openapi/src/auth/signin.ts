import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { passwordSchema } from './types';

export const SIGN_IN = '/auth/signin';

export const signinSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: passwordSchema,
});

export type ISignin = z.infer<typeof signinSchema>;

export const signinVoSchema = z.object({
  access_token: z.string(),
});

export type ISigninVo = z.infer<typeof signinVoSchema>;

export const SigninRoute: RouteConfig = registerRoute({
  method: 'post',
  path: SIGN_IN,
  description: 'Sign in',
  request: {
    body: {
      content: {
        'application/json': {
          schema: signinSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Sign in successfully',
      content: {
        'application/json': {
          schema: signinVoSchema,
        },
      },
    },
  },
  tags: ['auth'],
});

export const signin = async (body: ISignin) => {
  return axios.post<ISigninVo>(SIGN_IN, body);
};
