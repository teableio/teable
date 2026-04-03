import { axios, ensureUndoRedoWindowIdHeader } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { streamSSE } from '../utils/sse';
import { z } from '../zod';
import { clearRoSchema, CLEAR_URL } from './clear';

export const CLEAR_STREAM_URL = `${CLEAR_URL}-stream`;

export const clearSelectionStreamProgressEventSchema = z.object({
  id: z.literal('progress'),
  phase: z.enum(['preparing', 'clearing']),
  batchIndex: z.number(),
  totalCount: z.number(),
  processedCount: z.number(),
  clearedCount: z.number(),
  batchProcessedCount: z.number(),
  batchClearedCount: z.number(),
});

export const clearSelectionStreamDoneEventSchema = z.object({
  id: z.literal('done'),
  totalCount: z.number(),
  processedCount: z.number(),
  clearedCount: z.number(),
  data: z.object({
    clearedCount: z.number(),
    clearedRecordIds: z.array(z.string()),
  }),
});

export const clearSelectionStreamErrorEventSchema = z.object({
  id: z.literal('error'),
  phase: z.enum(['preparing', 'guarding', 'clearing', 'publishing', 'finalizing']),
  batchIndex: z.number(),
  totalCount: z.number(),
  processedCount: z.number(),
  clearedCount: z.number(),
  recordIds: z.array(z.string()),
  message: z.string(),
  code: z.string().optional(),
});

export const clearSelectionStreamEventSchema = z.union([
  clearSelectionStreamProgressEventSchema,
  clearSelectionStreamDoneEventSchema,
  clearSelectionStreamErrorEventSchema,
]);

export type IClearSelectionStreamProgressEvent = z.infer<
  typeof clearSelectionStreamProgressEventSchema
>;
export type IClearSelectionStreamDoneEvent = z.infer<typeof clearSelectionStreamDoneEventSchema>;
export type IClearSelectionStreamErrorEvent = z.infer<typeof clearSelectionStreamErrorEventSchema>;
export type IClearSelectionStreamEvent = z.infer<typeof clearSelectionStreamEventSchema>;

export const ClearStreamRoute = registerRoute({
  method: 'patch',
  path: CLEAR_STREAM_URL,
  summary: 'Clear selected range content with SSE progress',
  description: 'Clear selected table cells and stream realtime progress for each committed chunk.',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: clearRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'SSE stream with clear progress events and final result',
    },
  },
  tags: ['selection'],
});

export const clearSelectionStream = async (
  tableId: string,
  clearRo: z.input<typeof clearRoSchema>,
  options?: {
    onProgress?: (event: IClearSelectionStreamProgressEvent) => void;
    onError?: (event: IClearSelectionStreamErrorEvent) => void;
    signal?: AbortSignal;
    headers?: RequestInit['headers'];
  }
): Promise<{
  data: null;
  done: IClearSelectionStreamDoneEvent;
  errors: IClearSelectionStreamErrorEvent[];
}> => {
  const url = axios.getUri({
    baseURL: axios.defaults.baseURL || '/api',
    url: urlBuilder(CLEAR_STREAM_URL, { tableId }),
  });

  let doneEvent: IClearSelectionStreamDoneEvent | null = null;
  const errors: IClearSelectionStreamErrorEvent[] = [];

  ensureUndoRedoWindowIdHeader();

  await streamSSE<IClearSelectionStreamEvent>(
    url,
    {
      method: 'PATCH',
      signal: options?.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: JSON.stringify(clearRo),
    },
    {
      errorPrefix: 'Clear selection stream failed',
      onResult: (result) => {
        switch (result.id) {
          case 'progress':
            options?.onProgress?.(result);
            return;
          case 'done':
            doneEvent = result;
            return;
          case 'error':
            errors.push(result);
            options?.onError?.(result);
            return;
        }
      },
    }
  );

  if (!doneEvent) {
    const lastError = errors.at(-1);
    if (lastError) {
      throw new Error(lastError.message);
    }
    throw new Error('Clear selection stream ended without result');
  }

  return { data: null, done: doneEvent, errors };
};
