import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IRecord } from '@teable/core';
import type { AxiosResponse } from 'axios';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_RECORD_URL = '/table/{tableId}/record/{recordId}';

export const DeleteRecordRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_RECORD_URL,
  summary: 'Delete record',
  description: 'Permanently delete a single record by its ID.',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Deleted successfully',
    },
  },
  tags: ['record'],
});

export async function deleteRecord(
  tableId: string,
  recordId: string
): Promise<AxiosResponse<IRecord>> {
  return axios.delete<IRecord>(urlBuilder(DELETE_RECORD_URL, { tableId, recordId }));
}
