import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { fieldsViewVisibleRoSchema } from '@teable-group/core';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const VIEW_FIELD_VISIBLE = '/table/{tableId}/view/{viewId}/fieldVisible';

export const SetFieldsViewRoute: RouteConfig = registerRoute({
  method: 'post',
  path: VIEW_FIELD_VISIBLE,
  description: 'Update view fields visible',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: fieldsViewVisibleRoSchema,
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
