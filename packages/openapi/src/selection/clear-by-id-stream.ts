import { axios, ensureUndoRedoWindowIdHeader } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { streamSSE } from '../utils/sse';
import { z } from '../zod';
import {
  type IClearSelectionStreamDoneEvent,
  type IClearSelectionStreamErrorEvent,
  type IClearSelectionStreamEvent,
  type IClearSelectionStreamProgressEvent,
} from './clear-stream';
import { selectionIdsRoSchema, type ISelectionIdsRo } from './id';

export const CLEAR_BY_ID_STREAM_URL = '/table/{tableId}/selection/clear-by-id-stream';

export const ClearByIdStreamRoute = registerRoute({
  method: 'patch',
  path: CLEAR_BY_ID_STREAM_URL,
  summary: 'Clear selected cells by record and field ids with SSE progress',
  request: {
    params: z.object({ tableId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: selectionIdsRoSchema,
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

export const clearSelectionByIdStream = async (
  tableId: string,
  clearRo: ISelectionIdsRo,
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
    url: urlBuilder(CLEAR_BY_ID_STREAM_URL, { tableId }),
  });

  let doneEvent: IClearSelectionStreamDoneEvent | null = null;
  const errors: IClearSelectionStreamErrorEvent[] = [];

  ensureUndoRedoWindowIdHeader();

  await streamSSE<IClearSelectionStreamEvent>(
    url,
    {
      method: 'PATCH',
      signal: options?.signal,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      body: JSON.stringify(clearRo),
    },
    {
      errorPrefix: 'Clear selection by id stream failed',
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
    throw new Error('Clear selection by id stream ended without result');
  }

  return { data: null, done: doneEvent, errors };
};
