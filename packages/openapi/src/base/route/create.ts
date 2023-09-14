import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { CREATE_BASE } from '../path';
import { createBaseRoSchema, createBaseVoSchema } from '../schema';

export const CreateBaseRoute: RouteConfig = {
  method: 'post',
  path: CREATE_BASE,
  description: 'Create a base station',
  request: {
    body: {
      content: {
        'application/json': {
          schema: createBaseRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns information about a successfully created base.',
      content: {
        'application/json': {
          schema: createBaseVoSchema,
        },
      },
    },
  },
  tags: ['base'],
};
