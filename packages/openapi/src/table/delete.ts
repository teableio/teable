import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_TABLE = '/space/{spaceId}/table/{tableId}';

export const DeleteTableRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_TABLE,
  description: 'Delete a table',
  request: {
    params: z.object({
      spaceId: z.string(),
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

export const deleteTable = async (spaceId: string, tableId: string) => {
  return axios.delete<null>(
    urlBuilder(DELETE_TABLE, {
      params: {
        spaceId,
        tableId,
      },
    })
  );
};
