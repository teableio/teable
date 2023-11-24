import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { filterSchema } from '@teable-group/core';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const VIEW_FILTER = '/table/{tableId}/view/{viewId}/filter';

export const SetViewFilterRoute: RouteConfig = registerRoute({
  method: 'put',
  path: VIEW_FILTER,
  description: 'Update view filter',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: filterSchema.openapi({ type: 'object' }),
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
