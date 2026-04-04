import { axios, ensureUndoRedoWindowIdHeader } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { streamSSE } from '../utils/sse';
import { z } from '../zod';
import type { IPasteRo, IPasteVo } from './paste';
import { pasteRoSchema, pasteVoSchema, PASTE_URL } from './paste';

export const PASTE_STREAM_URL = `${PASTE_URL}-stream`;

export const pasteSelectionStreamProgressEventSchema = z.object({
  id: z.literal('progress'),
  phase: z.enum(['preparing', 'pasting']),
  batchIndex: z.number(),
  totalCount: z.number(),
  processedCount: z.number(),
  updatedCount: z.number(),
  createdCount: z.number(),
  batchProcessedCount: z.number(),
});

export const pasteSelectionStreamDoneEventSchema = z.object({
  id: z.literal('done'),
  totalCount: z.number(),
  processedCount: z.number(),
  updatedCount: z.number(),
  createdCount: z.number(),
  data: z.object({
    updatedCount: z.number(),
    createdCount: z.number(),
    createdRecordIds: z.array(z.string()),
    ranges: pasteVoSchema.shape.ranges.optional(),
  }),
});

export const pasteSelectionStreamErrorEventSchema = z.object({
  id: z.literal('error'),
  phase: z.enum(['preparing', 'guarding', 'pasting', 'publishing', 'finalizing']),
  batchIndex: z.number(),
  totalCount: z.number(),
  processedCount: z.number(),
  updatedCount: z.number(),
  createdCount: z.number(),
  recordIds: z.array(z.string()),
  message: z.string(),
  code: z.string().optional(),
});

export const pasteSelectionStreamEventSchema = z.union([
  pasteSelectionStreamProgressEventSchema,
  pasteSelectionStreamDoneEventSchema,
  pasteSelectionStreamErrorEventSchema,
]);

export type IPasteSelectionStreamProgressEvent = z.infer<
  typeof pasteSelectionStreamProgressEventSchema
>;
export type IPasteSelectionStreamDoneEvent = z.infer<typeof pasteSelectionStreamDoneEventSchema>;
export type IPasteSelectionStreamErrorEvent = z.infer<typeof pasteSelectionStreamErrorEventSchema>;
export type IPasteSelectionStreamEvent = z.infer<typeof pasteSelectionStreamEventSchema>;

export const PasteStreamRoute = registerRoute({
  method: 'patch',
  path: PASTE_STREAM_URL,
  summary: 'Paste content with SSE progress',
  description:
    'Apply paste operation to the selected table range and stream realtime progress for each committed chunk.',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: pasteRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'SSE stream with paste progress events and final result',
    },
  },
  tags: ['selection'],
});

export const pasteSelectionStream = async (
  tableId: string,
  pasteRo: IPasteRo,
  options?: {
    onProgress?: (event: IPasteSelectionStreamProgressEvent) => void;
    onError?: (event: IPasteSelectionStreamErrorEvent) => void;
    signal?: AbortSignal;
    headers?: RequestInit['headers'];
  }
): Promise<{
  data: IPasteVo | null;
  done: IPasteSelectionStreamDoneEvent;
  errors: IPasteSelectionStreamErrorEvent[];
}> => {
  const url = axios.getUri({
    baseURL: axios.defaults.baseURL || '/api',
    url: urlBuilder(PASTE_STREAM_URL, { tableId }),
  });

  let doneEvent: IPasteSelectionStreamDoneEvent | null = null;
  const errors: IPasteSelectionStreamErrorEvent[] = [];

  ensureUndoRedoWindowIdHeader();

  await streamSSE<IPasteSelectionStreamEvent>(
    url,
    {
      method: 'PATCH',
      signal: options?.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: JSON.stringify(pasteRo),
    },
    {
      errorPrefix: 'Paste selection stream failed',
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
    throw new Error('Paste selection stream ended without result');
  }

  const finalDoneEvent = doneEvent as IPasteSelectionStreamDoneEvent;
  const data = finalDoneEvent.data.ranges ? { ranges: finalDoneEvent.data.ranges } : null;
  return { data, done: finalDoneEvent, errors };
};
