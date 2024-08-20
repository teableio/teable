import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { AxiosResponse } from 'axios';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { IRecordInsertOrderRo } from './create';
import { recordInsertOrderRoSchema } from './create';

export const DELETE_RECORD_URL = '/table/{tableId}/record/{recordId}';

export const DeleteRecordRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_RECORD_URL,
  description: 'Delete a record',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
    }),
    query: z.object({
      order: recordInsertOrderRoSchema.optional().openapi({
        description: 'Where the current Record can be reinserted when undone',
      }),
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
  recordId: string,
  order?: IRecordInsertOrderRo
): Promise<AxiosResponse<null>> {
  return axios.delete<null>(urlBuilder(DELETE_RECORD_URL, { tableId, recordId }), {
    params: { order },
  });
}
