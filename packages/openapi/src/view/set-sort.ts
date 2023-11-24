import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { sortSchema } from '@teable-group/core';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const VIEW_SORT = '/table/{tableId}/view/{viewId}/viewSort';

export const SetViewSortRoute: RouteConfig = registerRoute({
  method: 'put',
  path: VIEW_SORT,
  description: 'Update view sort',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: sortSchema,
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
