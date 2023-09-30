import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_VIEW = '/table/{tableId}/view/{viewId}';

export const DeleteViewRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_VIEW,
  description: 'Delete a view',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Deleted successfully',
    },
  },
  tags: ['view'],
});

export const deleteView = async (tableId: string, viewId: string) => {
  return axios.delete<null>(
    urlBuilder(DELETE_VIEW, {
      tableId,
      viewId,
    })
  );
};
