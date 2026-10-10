import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import type { IUserMeVo } from './user-me';
import { userMeVoSchema } from './user-me';

export const SIGN_IN_WITH_CODE = '/auth/signin-with-code';

export const signinWithCodeSchema = z.object({
  email: z.email().toLowerCase(),
  code: z.string().min(1),
});

export type ISigninWithCode = z.infer<typeof signinWithCodeSchema>;

export const SigninWithCodeRoute: RouteConfig = registerRoute({
  method: 'post',
  path: SIGN_IN_WITH_CODE,
  description: 'Sign in with the verification code sent to the email',
  request: {
    body: {
      content: {
        'application/json': {
          schema: signinWithCodeSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Sign in successfully',
      content: {
        'application/json': {
          schema: userMeVoSchema,
        },
      },
    },
  },
  tags: ['auth'],
});

export const signinWithCode = async (body: ISigninWithCode) => {
  return axios.post<IUserMeVo>(SIGN_IN_WITH_CODE, body);
};
