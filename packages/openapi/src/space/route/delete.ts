import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from '../../zod';
import { DELETE_SPACE } from '../path';

export const DeleteSpaceRoute: RouteConfig = {
  method: 'delete',
  path: DELETE_SPACE,
  description: 'Delete a space station by spaceId',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Deleted successfully',
    },
  },
  tags: ['space'],
};
