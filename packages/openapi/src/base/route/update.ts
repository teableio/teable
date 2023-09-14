import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from '../../zod';
import { UPDATE_BASE } from '../path';
import { updateBaseRoSchema, updateBaseVoSchema } from '../schema';

export const UpdateBaseRoute: RouteConfig = {
  method: 'patch',
  path: UPDATE_BASE,
  description: 'Update a base station info',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateBaseRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns information about a successfully updated base.',
      content: {
        'application/json': {
          schema: updateBaseVoSchema,
        },
      },
    },
  },
  tags: ['base'],
};
