import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { SING_IN } from '../path';
import { signinSchema, signinVoSchema } from '../schema';

export const SigninRoute: RouteConfig = {
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
    200: {
      description: 'Sign in successfully',
      content: {
        'application/json': {
          schema: signinVoSchema,
        },
      },
    },
  },
  tags: ['auth'],
};
