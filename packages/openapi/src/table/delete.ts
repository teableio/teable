import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_TABLE = '/base/{baseId}/table/{tableId}';

export const DeleteTableRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_TABLE,
  summary: 'Delete table',
  description: 'Move a table to trash. The table can be restored within the retention period.',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Table successfully moved to trash.',
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
