import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { getGraphRoSchema } from '@teable-group/core';
import { z } from '../../zod';
import { GET_CELL_GRAPH_URL } from '../path';

export const GetCellGraphRoute: RouteConfig = {
  method: 'post',
  path: GET_CELL_GRAPH_URL,
  description: 'get cell references graph',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: getGraphRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'get cell references graph',
    },
  },
  tags: ['graph'],
};
