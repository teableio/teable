import { axios, ensureUndoRedoWindowIdHeader } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { streamSSE } from '../utils/sse';
import { z } from '../zod';
import { selectionIdsRoSchema } from './id';
import type { IPasteVo } from './paste';
import { pasteRoSchema } from './paste';
import type {
  IPasteSelectionStreamDoneEvent,
  IPasteSelectionStreamErrorEvent,
  IPasteSelectionStreamEvent,
  IPasteSelectionStreamProgressEvent,
} from './paste-stream';

export const PASTE_BY_ID_STREAM_URL = '/table/{tableId}/selection/paste-by-id-stream';

export const pasteByIdStreamRoSchema = selectionIdsRoSchema.extend({
  content: pasteRoSchema.shape.content,
  header: pasteRoSchema.shape.header,
});

export type IPasteByIdStreamRo = z.infer<typeof pasteByIdStreamRoSchema>;

export const PasteByIdStreamRoute = registerRoute({
  method: 'patch',
  path: PASTE_BY_ID_STREAM_URL,
  summary: 'Paste content by record and field ids with SSE progress',
  request: {
    params: z.object({ tableId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: pasteByIdStreamRoSchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'SSE stream with paste progress events and final result' },
  },
  tags: ['selection'],
});

export const pasteSelectionByIdStream = async (
  tableId: string,
  pasteRo: IPasteByIdStreamRo,
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
    url: urlBuilder(PASTE_BY_ID_STREAM_URL, { tableId }),
  });

  let doneEvent: IPasteSelectionStreamDoneEvent | null = null;
  const errors: IPasteSelectionStreamErrorEvent[] = [];

  ensureUndoRedoWindowIdHeader();

  await streamSSE<IPasteSelectionStreamEvent>(
    url,
    {
      method: 'PATCH',
      signal: options?.signal,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      body: JSON.stringify(pasteRo),
    },
    {
      errorPrefix: 'Paste selection by id stream failed',
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
        }
      },
    }
  );

  if (!doneEvent) {
    const lastError = errors.at(-1);
    if (lastError) throw new Error(lastError.message);
    throw new Error('Paste selection by id stream ended without result');
  }

  const finalDoneEvent = doneEvent as IPasteSelectionStreamDoneEvent;
  const data = finalDoneEvent.data.ranges ? { ranges: finalDoneEvent.data.ranges } : null;
  return { data, done: finalDoneEvent, errors };
};
