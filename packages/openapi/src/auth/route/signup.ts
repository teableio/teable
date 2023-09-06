import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from '../../zod';
import { SING_UP } from '../path';
import { signupSchema } from '../schema';

export const SignupRoute: RouteConfig = {
  method: 'post',
  path: SING_UP,
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
    200: {
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
};
