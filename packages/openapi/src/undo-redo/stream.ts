import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios, ensureUndoRedoWindowIdHeader } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { streamSSE } from '../utils/sse';
import { z } from '../zod';
import { redoVoSchema, type IRedoVo } from './redo';
import { undoVoSchema, type IUndoVo } from './undo';

export const undoRedoStreamProgressEventSchema = z.object({
  id: z.literal('progress'),
  mode: z.enum(['undo', 'redo']),
  phase: z.enum(['preparing', 'replaying']),
  totalCount: z.number(),
  processedCount: z.number(),
  commandType: z.string().optional(),
  commandCount: z.number().optional(),
  engine: z.enum(['v1', 'v2']).optional(),
});

export const undoRedoStreamDoneEventSchema = z.object({
  id: z.literal('done'),
  mode: z.enum(['undo', 'redo']),
  status: z.enum(['fulfilled', 'empty']),
  engine: z.enum(['v1', 'v2']),
});

export const undoRedoStreamErrorEventSchema = z.object({
  id: z.literal('error'),
  mode: z.enum(['undo', 'redo']),
  message: z.string(),
  engine: z.enum(['v1', 'v2']).optional(),
});

export const undoRedoStreamEventSchema = z.union([
  undoRedoStreamProgressEventSchema,
  undoRedoStreamDoneEventSchema,
  undoRedoStreamErrorEventSchema,
]);

export type IUndoRedoStreamProgressEvent = z.infer<typeof undoRedoStreamProgressEventSchema>;
export type IUndoRedoStreamDoneEvent = z.infer<typeof undoRedoStreamDoneEventSchema>;
export type IUndoRedoStreamErrorEvent = z.infer<typeof undoRedoStreamErrorEventSchema>;
export type IUndoRedoStreamEvent = z.infer<typeof undoRedoStreamEventSchema>;
export type IUndoRedoStreamOptions = {
  onProgress?: (event: IUndoRedoStreamProgressEvent) => void;
  onError?: (event: IUndoRedoStreamErrorEvent) => void;
  signal?: AbortSignal;
  headers?: RequestInit['headers'];
};

export const OPERATION_UNDO_STREAM = '/table/{tableId}/undo-redo/undo-stream';
export const OPERATION_REDO_STREAM = '/table/{tableId}/undo-redo/redo-stream';

export const UndoStreamRoute: RouteConfig = registerRoute({
  method: 'post',
  path: OPERATION_UNDO_STREAM,
  description: 'Undo the last operation with SSE progress',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'SSE stream with undo progress events and final status',
    },
  },
  tags: ['record'],
});

export const RedoStreamRoute: RouteConfig = registerRoute({
  method: 'post',
  path: OPERATION_REDO_STREAM,
  description: 'Redo the last operation with SSE progress',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'SSE stream with redo progress events and final status',
    },
  },
  tags: ['record'],
});

const streamUndoRedo = async <TData extends IUndoVo | IRedoVo>(
  tableId: string,
  mode: 'undo' | 'redo',
  schema: typeof undoVoSchema | typeof redoVoSchema,
  options?: IUndoRedoStreamOptions
): Promise<{
  data: TData;
  done: IUndoRedoStreamDoneEvent;
  errors: IUndoRedoStreamErrorEvent[];
}> => {
  const url = axios.getUri({
    baseURL: axios.defaults.baseURL || '/api',
    url: urlBuilder(mode === 'undo' ? OPERATION_UNDO_STREAM : OPERATION_REDO_STREAM, { tableId }),
  });

  const state: { doneEvent?: IUndoRedoStreamDoneEvent } = {};
  const errors: IUndoRedoStreamErrorEvent[] = [];

  ensureUndoRedoWindowIdHeader();

  await streamSSE<IUndoRedoStreamEvent>(
    url,
    {
      method: 'POST',
      signal: options?.signal,
      headers: options?.headers,
    },
    {
      errorPrefix: `${mode === 'undo' ? 'Undo' : 'Redo'} stream failed`,
      onResult: (result) => {
        switch (result.id) {
          case 'progress':
            options?.onProgress?.(result);
            return;
          case 'done':
            state.doneEvent = result;
            return;
          case 'error':
            errors.push(result);
            options?.onError?.(result);
            return;
        }
      },
    }
  );

  const resolvedDoneEvent = state.doneEvent;
  if (!resolvedDoneEvent) {
    const lastError = errors.at(-1);
    if (lastError) {
      return {
        data: schema.parse({
          status: 'failed',
          errorMessage: lastError.message,
        }) as TData,
        done: {
          id: 'done',
          mode,
          status: 'empty',
          engine: lastError.engine ?? 'v2',
        },
        errors,
      };
    }
    throw new Error(`${mode === 'undo' ? 'Undo' : 'Redo'} stream ended without result`);
  }

  return {
    data: schema.parse({
      status: resolvedDoneEvent.status,
    }) as TData,
    done: resolvedDoneEvent,
    errors,
  };
};

export const undoStream = (tableId: string, options?: IUndoRedoStreamOptions) =>
  streamUndoRedo<IUndoVo>(tableId, 'undo', undoVoSchema, options);

export const redoStream = (tableId: string, options?: IUndoRedoStreamOptions) =>
  streamUndoRedo<IRedoVo>(tableId, 'redo', redoVoSchema, options);
