import { axios, ensureUndoRedoWindowIdHeader } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { streamSSE } from '../utils/sse';
import { z } from '../zod';
import { deleteVoSchema, type IDeleteVo } from './delete';
import type {
  IDeleteSelectionStreamDoneEvent,
  IDeleteSelectionStreamErrorEvent,
  IDeleteSelectionStreamEvent,
  IDeleteSelectionStreamProgressEvent,
} from './delete-stream';
import { selectionIdsRoSchema, type ISelectionIdsRo } from './id';

export const DELETE_BY_ID_STREAM_URL = '/table/{tableId}/selection/delete-by-id-stream';

export const DeleteByIdStreamRoute = registerRoute({
  method: 'patch',
  path: DELETE_BY_ID_STREAM_URL,
  summary: 'Delete selected records by ids with SSE progress',
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
    200: { description: 'SSE stream with delete progress events and final result' },
  },
  tags: ['selection'],
});

export const deleteSelectionByIdStream = async (
  tableId: string,
  deleteRo: ISelectionIdsRo,
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
    url: urlBuilder(DELETE_BY_ID_STREAM_URL, { tableId }),
  });

  let finalResult: IDeleteVo | null = null;
  let doneEvent: IDeleteSelectionStreamDoneEvent | null = null;
  const errors: IDeleteSelectionStreamErrorEvent[] = [];

  ensureUndoRedoWindowIdHeader();

  await streamSSE<IDeleteSelectionStreamEvent>(
    url,
    {
      method: 'PATCH',
      signal: options?.signal,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      body: JSON.stringify(deleteRo),
    },
    {
      errorPrefix: 'Delete selection by id stream failed',
      onResult: (result) => {
        switch (result.id) {
          case 'progress':
            options?.onProgress?.(result);
            return;
          case 'done':
            doneEvent = result;
            finalResult = deleteVoSchema.parse({ ids: result.data.deletedRecordIds });
            return;
          case 'error':
            errors.push(result);
            options?.onError?.(result);
        }
      },
    }
  );

  if (!finalResult || !doneEvent) {
    const lastError = errors.at(-1);
    if (lastError) throw new Error(lastError.message);
    throw new Error('Delete selection by id stream ended without result');
  }

  return { data: finalResult, done: doneEvent, errors };
};
