import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { CLEAR_URL } from '../path';
import { clearRoSchema } from '../schema';

export const ClearRoute: RouteConfig = {
  method: 'post',
  path: CLEAR_URL,
  description: 'Clarify the constituency section',
  request: {
    params: z.object({
      teableId: z.string(),
      viewId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: clearRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successful clean up',
    },
  },
  tags: ['selection'],
};
