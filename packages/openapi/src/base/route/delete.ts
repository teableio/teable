import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from '../../zod';
import { DELETE_BASE } from '../path';

export const DeleteBaseRoute: RouteConfig = {
  method: 'delete',
  path: DELETE_BASE,
  description: 'Delete a base station by baseId',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Deleted successfully',
    },
  },
  tags: ['base'],
};
