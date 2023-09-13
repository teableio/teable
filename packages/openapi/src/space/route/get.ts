import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from '../../zod';
import { GET_SPACE } from '../path';
import { getSpaceVoSchema } from '../schema';

export const GetSpaceRoute: RouteConfig = {
  method: 'get',
  path: GET_SPACE,
  description: 'Get a space station by spaceId',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns information about a space.',
      content: {
        'application/json': {
          schema: getSpaceVoSchema,
        },
      },
    },
  },
  tags: ['space'],
};
