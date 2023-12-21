import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';

export const SING_IN = '/auth/signin';

export const signinSchema = z.object({
  email: z.string().email(),
  password: z.string().describe('Minimum 8 chars').min(8, 'Minimum 8 chars'),
});

export type ISignin = z.infer<typeof signinSchema>;

export const signinVoSchema = z.object({
  access_token: z.string(),
});

export type ISigninVo = z.infer<typeof signinVoSchema>;

export const SigninRoute: RouteConfig = registerRoute({
  method: 'post',
  path: SING_IN,
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
  return axios.post<ISigninVo>(SING_IN, body);
};
