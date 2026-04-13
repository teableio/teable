import { axios, ensureUndoRedoWindowIdHeader } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { streamSSE } from '../utils/sse';
import { z } from '../zod';
import { deleteVoSchema, type IDeleteVo } from './delete';
import type { IRangesRo } from './range';
import { rangesQuerySchema } from './range';

export const DELETE_STREAM_URL = '/table/{tableId}/selection/delete-stream';

export const deleteSelectionStreamProgressEventSchema = z.object({
  id: z.literal('progress'),
  phase: z.enum(['preparing', 'deleting']),
  batchIndex: z.number(),
  totalCount: z.number(),
  deletedCount: z.number(),
  batchDeletedCount: z.number(),
});

export const deleteSelectionStreamDoneEventSchema = z.object({
  id: z.literal('done'),
  totalCount: z.number(),
  deletedCount: z.number(),
  data: z.object({
    deletedCount: z.number(),
    deletedRecordIds: z.array(z.string()),
  }),
});

export const deleteSelectionStreamErrorEventSchema = z.object({
  id: z.literal('error'),
  phase: z.enum(['preparing', 'guarding', 'deleting', 'publishing', 'finalizing']),
  batchIndex: z.number(),
  totalCount: z.number(),
  deletedCount: z.number(),
  recordIds: z.array(z.string()),
  message: z.string(),
  code: z.string().optional(),
});

export const deleteSelectionStreamEventSchema = z.union([
  deleteSelectionStreamProgressEventSchema,
  deleteSelectionStreamDoneEventSchema,
  deleteSelectionStreamErrorEventSchema,
]);

export type IDeleteSelectionStreamProgressEvent = z.infer<
  typeof deleteSelectionStreamProgressEventSchema
>;
export type IDeleteSelectionStreamDoneEvent = z.infer<typeof deleteSelectionStreamDoneEventSchema>;
export type IDeleteSelectionStreamErrorEvent = z.infer<
  typeof deleteSelectionStreamErrorEventSchema
>;
export type IDeleteSelectionStreamEvent = z.infer<typeof deleteSelectionStreamEventSchema>;

export const DeleteStreamRoute = registerRoute({
  method: 'get',
  path: DELETE_STREAM_URL,
  summary: 'Delete selected range data with SSE progress',
  description:
    'Delete records within the selected table range and stream realtime progress. Each successful chunk commits independently; disconnecting the client will not roll back already committed chunks.',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: rangesQuerySchema,
  },
  responses: {
    200: {
      description: 'SSE stream with deletion progress events and final result',
    },
  },
  tags: ['selection'],
});

const buildDeleteSelectionStreamParams = (deleteRo: IRangesRo) => ({
  ...deleteRo,
  filter: JSON.stringify(deleteRo.filter),
  orderBy: JSON.stringify(deleteRo.orderBy),
  groupBy: JSON.stringify(deleteRo.groupBy),
  ranges: JSON.stringify(deleteRo.ranges),
  collapsedGroupIds: JSON.stringify(deleteRo.collapsedGroupIds),
});

export const deleteSelectionStream = async (
  tableId: string,
  deleteRo: IRangesRo,
  options?: {
    onProgress?: (event: IDeleteSelectionStreamProgressEvent) => void;
    onError?: (event: IDeleteSelectionStreamErrorEvent) => void;
    signal?: AbortSignal;
    headers?: RequestInit['headers'];
  }
): Promise<{
  data: IDeleteVo;
  done: IDeleteSelectionStreamDoneEvent;
  errors: IDeleteSelectionStreamErrorEvent[];
}> => {
  const url = axios.getUri({
    baseURL: axios.defaults.baseURL || '/api',
    url: urlBuilder(DELETE_STREAM_URL, { tableId }),
    params: buildDeleteSelectionStreamParams(deleteRo),
  });

  let finalResult: IDeleteVo | null = null;
  let doneEvent: IDeleteSelectionStreamDoneEvent | null = null;
  const errors: IDeleteSelectionStreamErrorEvent[] = [];

  ensureUndoRedoWindowIdHeader();

  await streamSSE<IDeleteSelectionStreamEvent>(
    url,
    {
      method: 'GET',
      signal: options?.signal,
      headers: options?.headers,
    },
    {
      errorPrefix: 'Delete selection stream failed',
      onResult: (result) => {
        switch (result.id) {
          case 'progress':
            options?.onProgress?.(result);
            return;
          case 'done':
            doneEvent = result;
            finalResult = deleteVoSchema.parse({
              ids: result.data.deletedRecordIds,
            });
            return;
          case 'error':
            errors.push(result);
            options?.onError?.(result);
            return;
        }
      },
    }
  );

  if (!finalResult || !doneEvent) {
    const lastError = errors.at(-1);
    if (lastError) {
      throw new Error(lastError.message);
    }
    throw new Error('Delete selection stream ended without result');
  }

  return { data: finalResult, done: doneEvent, errors };
};
