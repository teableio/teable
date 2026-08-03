import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { AxiosResponse } from 'axios';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { undoVoSchema } from './undo';

export const OPERATION_REDO = '/table/{tableId}/undo-redo/redo';

export const redoVoSchema = undoVoSchema;

export type IRedoVo = z.infer<typeof redoVoSchema>;

export const RedoRoute: RouteConfig = registerRoute({
  method: 'post',
  path: OPERATION_REDO,
  description: 'Redo the last operation',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
  },
  responses: {
    201: {
      description: 'Returns data about the redo operation.',
      content: {
        'application/json': {
          schema: redoVoSchema,
        },
      },
    },
  },
  tags: ['record'],
});

export async function redo(tableId: string): Promise<AxiosResponse<IRedoVo>> {
  return axios.post<IRedoVo>(urlBuilder(OPERATION_REDO, { tableId }));
}
