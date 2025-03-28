import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { AxiosResponse } from 'axios';
import { z } from 'zod';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';

export const AUTO_FILL_FIELD = '/table/{tableId}/field/{fieldId}/auto-fill';

export const autoFillFieldVoSchema = z.object({
  taskId: z.string(),
});

export type IAutoFillFieldVo = z.infer<typeof autoFillFieldVoSchema>;

export const AutoFillFieldRoute: RouteConfig = registerRoute({
  method: 'post',
  path: AUTO_FILL_FIELD,
  summary: 'Auto-fill a field by AI',
  description: 'Automatically generate suggestions for filling a specific field',
  request: {
    params: z.object({
      tableId: z.string(),
      fieldId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the task ID for the auto-fill process',
      content: {
        'application/json': {
          schema: autoFillFieldVoSchema,
        },
      },
    },
  },
  tags: ['field'],
});

export async function autoFillField(
  tableId: string,
  fieldId: string
): Promise<AxiosResponse<IAutoFillFieldVo>> {
  return axios.post<IAutoFillFieldVo>(urlBuilder(AUTO_FILL_FIELD, { tableId, fieldId }));
}
