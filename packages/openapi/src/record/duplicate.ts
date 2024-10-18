import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { IRecordInsertOrderRo } from './create';
import { recordInsertOrderRoSchema } from './create';

export const DUPLICATE_URL = '/table/{tableId}/record/{recordId}';

export const duplicateVoSchema = z.object({
  ids: z.array(z.string()),
});

export type IDuplicateVo = z.infer<typeof duplicateVoSchema>;
export const duplicateRoute = registerRoute({
  method: 'post',
  path: DUPLICATE_URL,
  description: 'Duplicate the selected data',
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
          schema: duplicateVoSchema,
        },
      },
    },
  },
  tags: ['record'],
});

export const duplicateRecords = async (
  tableId: string,
  recordId: string,
  order: IRecordInsertOrderRo
) => {
  return axios.post<IDuplicateVo>(urlBuilder(DUPLICATE_URL, { tableId, recordId }), order);
};
