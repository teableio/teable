import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from '../../zod';
import { GET_SPACE_LIST } from '../path';
import { getSpaceVoSchema } from '../schema';

export const GetSpaceListRoute: RouteConfig = {
  method: 'get',
  path: GET_SPACE_LIST,
  description: 'Get space station list by query',
  request: {},
  responses: {
    200: {
      description: 'Returns the list of space.',
      content: {
        'application/json': {
          schema: z.array(getSpaceVoSchema),
        },
      },
    },
  },
  tags: ['space'],
};
