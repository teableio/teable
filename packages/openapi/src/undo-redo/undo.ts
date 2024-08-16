import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { AxiosResponse } from 'axios';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const OPERATION_UNDO = '/table/{tableId}/undo-redo/undo';

export const undoVoSchema = z.object({
  status: z.enum(['fulfilled', 'failed', 'empty']),
  errorMessage: z.string().optional(),
});

export type IUndoVo = z.infer<typeof undoVoSchema>;

export const UndoRoute: RouteConfig = registerRoute({
  method: 'post',
  path: OPERATION_UNDO,
  description: 'Undo the last operation',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
  },
  responses: {
    201: {
      description: 'Returns data about the undo operation.',
      content: {
        'application/json': {
          schema: undoVoSchema,
        },
      },
    },
  },
  tags: ['record'],
});

export async function undo(tableId: string): Promise<AxiosResponse<IUndoVo>> {
  return axios.post<IUndoVo>(urlBuilder(OPERATION_UNDO, { tableId }));
}
