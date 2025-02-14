import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IRecord } from '@teable/core';
import { recordSchema } from '@teable/core';
import type { AxiosResponse } from 'axios';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { IUpdateRecordsRo } from './update';
import { updateRecordsRoSchema } from './update';

export const UPDATE_RECORDS = '/table/{tableId}/record';

export const UpdateRecordsRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_RECORDS,
  summary: 'Update multiple records',
  description:
    'Update multiple records in a single request with support for field value typecast and record reordering.',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateRecordsRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns the records data after update.',
      content: {
        'application/json': {
          schema: z.array(recordSchema),
        },
      },
    },
  },
  tags: ['record'],
});

export async function updateRecords(
  tableId: string,
  recordsRo: IUpdateRecordsRo
): Promise<AxiosResponse<IRecord[]>> {
  return axios.patch<IRecord[]>(urlBuilder(UPDATE_RECORDS, { tableId }), recordsRo);
}
