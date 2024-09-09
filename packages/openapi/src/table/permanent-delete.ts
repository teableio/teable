import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PERMANENT_DELETE_TABLE = '/base/{baseId}/table/{tableId}/permanent';

export const PermanentDeleteTableRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: PERMANENT_DELETE_TABLE,
  description: 'Permanently delete a table',
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

export const permanentDeleteTable = async (baseId: string, tableId: string) => {
  return axios.delete<null>(
    urlBuilder(PERMANENT_DELETE_TABLE, {
      baseId,
      tableId,
    })
  );
};
