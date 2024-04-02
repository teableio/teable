import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IRecord } from '@teable/core';
import { recordSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { updateRecordOrdersRoSchema } from '../view';
import { z } from '../zod';
import { updateRecordRoSchema } from './update';

export const updateRecordWithOrderRoSchema = updateRecordOrdersRoSchema
  .omit({
    recordIds: true,
  })
  .merge(updateRecordRoSchema);

export type IUpdateRecordWithOrderRo = z.infer<typeof updateRecordWithOrderRoSchema>;

export const UPDATE_RECORD_WITH_ORDER = '/table/{tableId}/record/{viewId}/{recordId}';

export const UpdateRecordWithOrderRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_RECORD_WITH_ORDER,
  description: 'Update a record with order',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
      recordId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateRecordWithOrderRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns record data after update.',
      content: {
        'application/json': {
          schema: recordSchema,
        },
      },
    },
  },
  tags: ['record'],
});

export const updateRecordWithOrder = async (
  tableId: string,
  viewId: string,
  recordId: string,
  recordWithOrderRo: IUpdateRecordWithOrderRo
) => {
  return axios.patch<IRecord>(
    urlBuilder(UPDATE_RECORD_WITH_ORDER, {
      tableId,
      viewId,
      recordId,
    }),
    recordWithOrderRo
  );
};
