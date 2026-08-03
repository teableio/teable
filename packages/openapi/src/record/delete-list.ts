import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { AxiosResponse } from 'axios';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_RECORDS_URL = '/table/{tableId}/record';

export const deleteRecordsQuerySchema = z.object({
  recordIds: z.array(z.string()),
});

export type IDeleteRecordsQuery = z.infer<typeof deleteRecordsQuerySchema>;

export const DeleteRecordsRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_RECORDS_URL,
  summary: 'Delete records',
  description: 'Permanently delete multiple records by their IDs in a single request.',
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

// Function overloads for deleteRecords
export async function deleteRecords(
  tableId: string,
  recordIds: string[]
): Promise<AxiosResponse<null>> {
  return axios.delete<null>(urlBuilder(DELETE_RECORDS_URL, { tableId }), {
    params: { recordIds },
  });
}
