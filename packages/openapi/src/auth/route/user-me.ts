import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { USER_ME } from '../path';
import { userMeVoSchema } from '../schema';

export const userMeRoute: RouteConfig = {
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
};
