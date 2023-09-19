import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from '../../zod';
import { UPDATE_SPACE } from '../path';
import { updateSpaceRoSchema, updateSpaceVoSchema } from '../schema';

export const UpdateSpaceRoute: RouteConfig = {
  method: 'patch',
  path: UPDATE_SPACE,
  description: 'Update a space station info',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateSpaceRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns information about a successfully updated space.',
      content: {
        'application/json': {
          schema: updateSpaceVoSchema,
        },
      },
    },
  },
  tags: ['space'],
};
