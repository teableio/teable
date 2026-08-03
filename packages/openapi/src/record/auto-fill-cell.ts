import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { AxiosResponse } from 'axios';
import { z } from 'zod';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';

export const AUTO_FILL_CELL = '/table/{tableId}/record/{recordId}/{fieldId}/auto-fill';

export const autoFillCellVoSchema = z.object({
  taskId: z.string(),
});

export type IAutoFillCellVo = z.infer<typeof autoFillCellVoSchema>;

export const AutoFillCellRoute: RouteConfig = registerRoute({
  method: 'post',
  path: AUTO_FILL_CELL,
  summary: 'Auto-fill a cell by AI',
  description: 'Automatically fill a cell in a specific record and field',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
      fieldId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the updated record status',
      content: {
        'application/json': {
          schema: z.object({
            status: z.string(),
          }),
        },
      },
    },
  },
  tags: ['record'],
});

export async function autoFillCell(
  tableId: string,
  recordId: string,
  fieldId: string
): Promise<AxiosResponse<IAutoFillCellVo>> {
  return axios.post<IAutoFillCellVo>(urlBuilder(AUTO_FILL_CELL, { tableId, recordId, fieldId }));
}
