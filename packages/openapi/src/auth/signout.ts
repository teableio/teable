import { axios } from '../axios';
import { registerRoute } from '../utils';
import type { RouteConfig } from '../zod-to-openapi';

export const SING_OUT = '/auth/signout';

export const SignoutRoute: RouteConfig = registerRoute({
  method: 'post',
  path: SING_OUT,
  description: 'Sign out',
  responses: {
    201: {
      description: 'Sign out successfully',
    },
  },
  tags: ['auth'],
});

export const signout = async () => {
  return axios.post<null>(SING_OUT);
};
