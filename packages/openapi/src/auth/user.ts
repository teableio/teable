import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const USER_INFO = '/auth/user';

export const userInfoVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatar: z.string().optional().nullable(),
  email: z.string().email().optional(),
});

export type IUserInfoVo = z.infer<typeof userInfoVoSchema>;

export const userInfoRoute: RouteConfig = registerRoute({
  method: 'get',
  path: USER_INFO,
  description: 'Get user information via access token',
  responses: {
    200: {
      description: 'Successfully retrieved user information',
      content: {
        'application/json': {
          schema: userInfoVoSchema,
        },
      },
    },
  },
  tags: ['auth'],
});

export const userInfo = async () => {
  return axios.get<IUserInfoVo>(USER_INFO);
};
