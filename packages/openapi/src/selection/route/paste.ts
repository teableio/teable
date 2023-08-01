import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { PASTE_URL } from '../path';
import { pasteRoSchema, pasteVoSchema } from '../schema';

export const PasteRoute: RouteConfig = {
  method: 'post',
  path: PASTE_URL,
  description: 'Copy operations in tables',
  request: {
    params: z.object({
      teableId: z.string(),
      viewId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: pasteRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Paste successfully',
      content: {
        'application/json': {
          schema: pasteVoSchema,
        },
      },
    },
  },
  tags: ['selection'],
};
