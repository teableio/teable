import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { CREATE_SPACE } from '../path';
import { createSpaceRoSchema, createSpaceVoSchema } from '../schema';

export const CreateSpaceRoute: RouteConfig = {
  method: 'post',
  path: CREATE_SPACE,
  description: 'Create a space station',
  request: {
    body: {
      content: {
        'application/json': {
          schema: createSpaceRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns information about a successfully created space.',
      content: {
        'application/json': {
          schema: createSpaceVoSchema,
        },
      },
    },
  },
  tags: ['space'],
};
