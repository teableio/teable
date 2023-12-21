import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';

export const DELETE_RECORDS_URL = '/table/{tableId}/record';

export const deleteRecordsQuerySchema = z.object({
  recordIds: z.array(z.string()),
});

export type IDeleteRecordsQuery = z.infer<typeof deleteRecordsQuerySchema>;

export const DeleteRecordsRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_RECORDS_URL,
  description: 'Delete multiple records',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: deleteRecordsQuerySchema,
  },
  responses: {
    200: {
      description: 'Deleted successfully',
    },
  },
  tags: ['record'],
});

export const deleteRecords = async (tableId: string, recordIds: string[]) => {
  return axios.delete<null>(
    urlBuilder(DELETE_RECORDS_URL, {
      tableId,
    }),
    {
      params: {
        recordIds,
      },
    }
  );
};
