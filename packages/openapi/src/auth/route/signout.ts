import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { SING_OUT } from '../path';

export const SignoutRoute: RouteConfig = {
  method: 'post',
  path: SING_OUT,
  description: 'Sign out',
  responses: {
    200: {
      description: 'Sign out successfully',
    },
  },
  tags: ['auth'],
};
