import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_TABLE_ARBITRARY = '/base/{baseId}/table/arbitrary/{tableId}';

export const DeleteTableArbitraryRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_TABLE_ARBITRARY,
  description: 'Delete a table forever',
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

export const deleteTableArbitrary = async (baseId: string, tableId: string) => {
  return axios.delete<null>(
    urlBuilder(DELETE_TABLE_ARBITRARY, {
      baseId,
      tableId,
    })
  );
};
