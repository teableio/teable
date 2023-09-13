import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from '../../zod';
import { GET_BASE } from '../path';
import { getBaseVoSchema } from '../schema';

export const GetBaseRoute: RouteConfig = {
  method: 'get',
  path: GET_BASE,
  description: 'Get a base station by baseId',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns information about a base.',
      content: {
        'application/json': {
          schema: getBaseVoSchema,
        },
      },
    },
  },
  tags: ['base'],
};
