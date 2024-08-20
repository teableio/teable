import { axios } from '../axios';
import type { ICreateRecordsVo } from '../record/create';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { IRangesRo } from './range';
export const DUPLICATE_URL = '/table/{tableId}/selection/duplicate';

export const duplicateVoSchema = z.object({
  ids: z.array(z.string()),
});

export type IDuplicateVo = ICreateRecordsVo;

export const duplicateRoute = registerRoute({
  method: 'get',
  path: DUPLICATE_URL,
  description: 'Duplicate the selected data',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Successful duplicate',
      content: {
        'application/json': {
          schema: duplicateVoSchema,
        },
      },
    },
  },
  tags: ['selection'],
});

export const duplicate = async (tableId: string, duplicateRo: IRangesRo) => {
  return axios.get<IDuplicateVo>(
    urlBuilder(DUPLICATE_URL, {
      tableId,
    }),
    {
      params: {
        ...duplicateRo,
        filter: JSON.stringify(duplicateRo.filter),
        orderBy: JSON.stringify(duplicateRo.orderBy),
        groupBy: JSON.stringify(duplicateRo.groupBy),
        ranges: JSON.stringify(duplicateRo.ranges),
      },
    }
  );
};
