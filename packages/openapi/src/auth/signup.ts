import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { signinSchema, signinVoSchema } from './signin';

export const SIGN_UP = '/auth/signup';

export const signupSchema = signinSchema.extend({
  defaultSpaceName: z.string().optional(),
});

export type ISignup = z.infer<typeof signupSchema>;

export const signupVoSchema = signinVoSchema;

export type ISignupVo = z.infer<typeof signupVoSchema>;

export const SignupRoute: RouteConfig = registerRoute({
  method: 'post',
  path: SIGN_UP,
  description: 'Sign up',
  request: {
    body: {
      content: {
        'application/json': {
          schema: signupSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Sign up and sing in successfully',
      content: {
        'application/json': {
          schema: z.object({
            access_token: z.string(),
          }),
        },
      },
    },
  },
  tags: ['auth'],
});

export const signup = async (body: ISignup) => {
  return axios.post<ISignupVo>(SIGN_UP, body);
};
