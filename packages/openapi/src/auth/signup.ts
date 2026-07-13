import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { SPACE_NAME_MAX_LENGTH } from '../space/create';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { signinSchema } from './signin';
import { signupPasswordSchema } from './types';
import type { IUserMeVo } from './user-me';
import { userMeVoSchema } from './user-me';

export const SIGN_UP = '/auth/signup';

export const refMetaSchema = z.object({
  query: z.string().optional(),
  referer: z.string().optional(),
});

export type IRefMeta = z.infer<typeof refMetaSchema>;

export const signupSchema = signinSchema.extend({
  defaultSpaceName: z.string().min(1).max(SPACE_NAME_MAX_LENGTH).optional(),
  refMeta: refMetaSchema.optional(),
  password: signupPasswordSchema,
  verification: z
    .object({
      code: z.string(),
      token: z.string(),
    })
    .optional(),
  inviteCode: z.string().optional(),
  turnstileToken: z.string().optional(),
});

export type ISignup = z.infer<typeof signupSchema>;

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
          schema: userMeVoSchema,
        },
      },
    },
  },
  tags: ['auth'],
});

export const signup = async (body: ISignup) => {
  return axios.post<IUserMeVo>(SIGN_UP, body);
};
