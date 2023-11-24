import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { viewOptionRoSchema } from '@teable-group/core';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const VIEW_SHORT = '/table/{tableId}/view/{viewId}/option';

export const SetViewShortRoute: RouteConfig = registerRoute({
  method: 'put',
  path: VIEW_SHORT,
  description: 'Update view option',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: viewOptionRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully update.',
    },
  },
  tags: ['view'],
});
