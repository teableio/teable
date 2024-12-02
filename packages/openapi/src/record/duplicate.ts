import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { ICreateRecordsVo, IRecordInsertOrderRo } from './create';
import { createRecordsVoSchema, recordInsertOrderRoSchema } from './create';

export const DUPLICATE_URL = '/table/{tableId}/record/{recordId}';

export const duplicateRoute = registerRoute({
  method: 'post',
  path: DUPLICATE_URL,
  description: 'Duplicate the selected record',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: recordInsertOrderRoSchema.optional(),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successful duplicate',
      content: {
        'application/json': {
          schema: createRecordsVoSchema,
        },
      },
    },
  },
  tags: ['record'],
});

export const duplicateRecord = async (
  tableId: string,
  recordId: string,
  order: IRecordInsertOrderRo
) => {
  return axios.post<ICreateRecordsVo>(urlBuilder(DUPLICATE_URL, { tableId, recordId }), order);
};
