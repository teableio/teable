import { axios, ensureUndoRedoWindowIdHeader } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { streamSSE } from '../utils/sse';
import { z } from '../zod';
import type { IRangesRo } from './range';
import { rangesQuerySchema } from './range';

export const DUPLICATE_STREAM_URL = '/table/{tableId}/selection/duplicate-stream';

export const duplicateSelectionStreamProgressEventSchema = z.object({
  id: z.literal('progress'),
  phase: z.enum(['preparing', 'duplicating']),
  batchIndex: z.number(),
  totalCount: z.number(),
  duplicatedCount: z.number(),
  batchDuplicatedCount: z.number(),
});

export const duplicateSelectionStreamDoneEventSchema = z.object({
  id: z.literal('done'),
  totalCount: z.number(),
  duplicatedCount: z.number(),
  data: z.object({
    duplicatedCount: z.number(),
    duplicatedRecordIds: z.array(z.string()),
  }),
});

export const duplicateSelectionStreamErrorEventSchema = z.object({
  id: z.literal('error'),
  phase: z.enum(['preparing', 'guarding', 'duplicating', 'publishing', 'finalizing']),
  batchIndex: z.number(),
  totalCount: z.number(),
  duplicatedCount: z.number(),
  recordIds: z.array(z.string()),
  message: z.string(),
  code: z.string().optional(),
});

export const duplicateSelectionStreamEventSchema = z.union([
  duplicateSelectionStreamProgressEventSchema,
  duplicateSelectionStreamDoneEventSchema,
  duplicateSelectionStreamErrorEventSchema,
]);

export type IDuplicateSelectionStreamProgressEvent = z.infer<
  typeof duplicateSelectionStreamProgressEventSchema
>;
export type IDuplicateSelectionStreamDoneEvent = z.infer<
  typeof duplicateSelectionStreamDoneEventSchema
>;
export type IDuplicateSelectionStreamErrorEvent = z.infer<
  typeof duplicateSelectionStreamErrorEventSchema
>;
export type IDuplicateSelectionStreamEvent = z.infer<typeof duplicateSelectionStreamEventSchema>;

export const DuplicateStreamRoute = registerRoute({
  method: 'get',
  path: DUPLICATE_STREAM_URL,
  summary: 'Duplicate selected records with SSE progress',
  description:
    'Duplicate records within the selected table range and stream realtime progress. Each successful chunk commits independently; disconnecting the client will not roll back already committed chunks.',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: rangesQuerySchema,
  },
  responses: {
    200: {
      description: 'SSE stream with duplication progress events and final result',
    },
  },
  tags: ['selection'],
});

const buildDuplicateSelectionStreamParams = (rangesRo: IRangesRo) => ({
  ...rangesRo,
  filter: JSON.stringify(rangesRo.filter),
  orderBy: JSON.stringify(rangesRo.orderBy),
  groupBy: JSON.stringify(rangesRo.groupBy),
  ranges: JSON.stringify(rangesRo.ranges),
  collapsedGroupIds: JSON.stringify(rangesRo.collapsedGroupIds),
});

export const duplicateSelectionStream = async (
  tableId: string,
  rangesRo: IRangesRo,
  options?: {
    onProgress?: (event: IDuplicateSelectionStreamProgressEvent) => void;
    onError?: (event: IDuplicateSelectionStreamErrorEvent) => void;
    signal?: AbortSignal;
    headers?: RequestInit['headers'];
  }
): Promise<{
  done: IDuplicateSelectionStreamDoneEvent;
  errors: IDuplicateSelectionStreamErrorEvent[];
}> => {
  const url = axios.getUri({
    baseURL: axios.defaults.baseURL || '/api',
    url: urlBuilder(DUPLICATE_STREAM_URL, { tableId }),
    params: buildDuplicateSelectionStreamParams(rangesRo),
  });

  let doneEvent: IDuplicateSelectionStreamDoneEvent | null = null;
  const errors: IDuplicateSelectionStreamErrorEvent[] = [];

  ensureUndoRedoWindowIdHeader();

  await streamSSE<IDuplicateSelectionStreamEvent>(
    url,
    {
      method: 'GET',
      signal: options?.signal,
      headers: options?.headers,
    },
    {
      errorPrefix: 'Duplicate selection stream failed',
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
    throw new Error('Duplicate selection stream ended without result');
  }

  return { done: doneEvent, errors };
};
