import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';

export const DELETE_TABLE = '/base/{baseId}/table/{tableId}';

export const DeleteTableRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_TABLE,
  description: 'Delete a table',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Deleted successfully',
    },
  },
  tags: ['table'],
});

export const deleteTable = async (baseId: string, tableId: string) => {
  return axios.delete<null>(
    urlBuilder(DELETE_TABLE, {
      baseId,
      tableId,
    })
  );
};
