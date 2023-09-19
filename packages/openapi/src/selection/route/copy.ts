import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from '../../zod';
import { COPY_URL } from '../path';
import { copyRoSchema, copyVoSchema } from '../schema';

export const CopyRoute: RouteConfig = {
  method: 'get',
  path: COPY_URL,
  description: 'Copy operations in tables',
  request: {
    params: z.object({
      teableId: z.string(),
      viewId: z.string(),
    }),
    query: copyRoSchema,
  },
  responses: {
    200: {
      description: 'Copy content',
      content: {
        'application/json': {
          schema: copyVoSchema,
        },
      },
    },
  },
  tags: ['selection'],
};
