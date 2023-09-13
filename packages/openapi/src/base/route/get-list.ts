import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from '../../zod';
import { GET_BASE_LIST } from '../path';
import { getBaseListRoSchema, getBaseVoSchema } from '../schema';

export const GetBaseListRoute: RouteConfig = {
  method: 'get',
  path: GET_BASE_LIST,
  description: 'Get base station list by query',
  request: {
    query: getBaseListRoSchema,
  },
  responses: {
    200: {
      description: 'Returns the list of base.',
      content: {
        'application/json': {
          schema: z.array(getBaseVoSchema),
        },
      },
    },
  },
  tags: ['base'],
};
