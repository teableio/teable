import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { AxiosResponse } from 'axios';
import { z } from 'zod';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';

export const STOP_FILL_FIELD = '/table/{tableId}/field/{fieldId}/stop-fill';

export const StopFillFieldRoute: RouteConfig = registerRoute({
  method: 'post',
  path: STOP_FILL_FIELD,
  summary: 'Stop auto-fill a field by AI',
  description: 'Stop auto-fill a field by AI',
  request: {
    params: z.object({
      tableId: z.string(),
      fieldId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Stop auto-fill a field by AI successfully',
    },
  },
  tags: ['field'],
});

export async function stopFillField(
  tableId: string,
  fieldId: string
): Promise<AxiosResponse<null>> {
  return axios.post<null>(urlBuilder(STOP_FILL_FIELD, { tableId, fieldId }));
}
