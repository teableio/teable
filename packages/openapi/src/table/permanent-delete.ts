import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PERMANENT_DELETE_TABLE = '/base/{baseId}/table/{tableId}/permanent';

export const PermanentDeleteTableRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: PERMANENT_DELETE_TABLE,
  summary: 'Permanently delete table',
  description: 'Permanently delete a table and all its data. This action cannot be undone.',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Table and all associated data permanently deleted.',
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
