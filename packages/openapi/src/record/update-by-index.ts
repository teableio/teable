import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IRecord, IUpdateRecordByIndexRo } from '@teable-group/core';
import { recordSchema, updateRecordByIndexRoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const UPDATE_RECORD_BY_INDEX = '/table/{tableId}/record';

export const UpdateRecordByIndexRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_RECORD_BY_INDEX,
  description: 'Update a record',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateRecordByIndexRoSchema,
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

export const updateRecordByIndex = async (tableId: string, recordRo: IUpdateRecordByIndexRo) => {
  return axios.patch<IRecord>(urlBuilder(UPDATE_RECORD_BY_INDEX, { tableId }), recordRo);
};
