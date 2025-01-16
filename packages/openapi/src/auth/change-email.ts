import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const CHANGE_EMAIL = '/auth/change-email';

export const changeEmailRoSchema = z.object({
  email: z.string().email(),
  token: z.string(),
  code: z.string(),
});

export type IChangeEmailRo = z.infer<typeof changeEmailRoSchema>;

export const changeEmailRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: CHANGE_EMAIL,
  description: 'Change email',
  request: {
    body: {
      content: {
        'application/json': {
          schema: changeEmailRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Change email successfully',
    },
  },
  tags: ['auth'],
});

export const changeEmail = async (ro: IChangeEmailRo) => {
  return axios.patch<void>(CHANGE_EMAIL, ro);
};
