import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { userNotifyMetaSchema } from '../user';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const USER_ME = '/auth/user/me';

export const userMeVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatar: z.string().nullable().optional(),
  email: z.string().email(),
  phone: z.string().nullable().optional(),
  notifyMeta: userNotifyMetaSchema,
  hasPassword: z.boolean(),
  isAdmin: z.boolean().nullable().optional(),
  organization: z
    .object({
      id: z.string(),
      name: z.string(),
      departments: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
        })
      ),
      isAdmin: z.boolean().optional(),
    })
    .optional(),
});

export type IUserMeVo = z.infer<typeof userMeVoSchema>;

export const userMeRoute: RouteConfig = registerRoute({
  method: 'get',
  path: USER_ME,
  description: 'Get user information',
  responses: {
    200: {
      description: 'Successfully retrieved user information',
      content: {
        'application/json': {
          schema: userMeVoSchema,
        },
      },
    },
  },
  tags: ['auth'],
});

export const userMe = async () => {
  return axios.get<IUserMeVo>(USER_ME);
};
