import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { streamSSE } from '../utils/sse';
import { z } from '../zod';

export const RESTORE_TRASH = '/trash/restore/{trashId}';
export const RESTORE_FIELD_TRASH_STREAM = '/trash/restore-field/{trashId}/stream';

export const restoreFieldTrashStreamProgressEventSchema = z.object({
  id: z.literal('progress'),
  phase: z.enum(['preparing', 'restoring']),
  batchIndex: z.number(),
  totalCount: z.number(),
  processedCount: z.number(),
  updatedCount: z.number(),
});

export const restoreFieldTrashStreamDoneEventSchema = z.object({
  id: z.literal('done'),
  totalCount: z.number(),
  updatedCount: z.number(),
});

export const restoreFieldTrashStreamErrorEventSchema = z.object({
  id: z.literal('error'),
  phase: z.enum(['preparing', 'restoring', 'finalizing']),
  batchIndex: z.number(),
  totalCount: z.number(),
  processedCount: z.number(),
  updatedCount: z.number(),
  message: z.string(),
  code: z.string().optional(),
});

export const restoreFieldTrashStreamEventSchema = z.union([
  restoreFieldTrashStreamProgressEventSchema,
  restoreFieldTrashStreamDoneEventSchema,
  restoreFieldTrashStreamErrorEventSchema,
]);

export type IRestoreFieldTrashStreamProgressEvent = z.infer<
  typeof restoreFieldTrashStreamProgressEventSchema
>;
export type IRestoreFieldTrashStreamDoneEvent = z.infer<
  typeof restoreFieldTrashStreamDoneEventSchema
>;
export type IRestoreFieldTrashStreamErrorEvent = z.infer<
  typeof restoreFieldTrashStreamErrorEventSchema
>;
export type IRestoreFieldTrashStreamEvent = z.infer<typeof restoreFieldTrashStreamEventSchema>;

export const RestoreTrashRoute: RouteConfig = registerRoute({
  method: 'post',
  path: RESTORE_TRASH,
  description: 'restore a space, base, table, etc.',
  request: {
    params: z.object({
      trashId: z.string(),
    }),
    query: z.object({
      tableId: z.string().optional(),
    }),
  },
  responses: {
    201: {
      description: 'Restored successfully',
    },
  },
  tags: ['space'],
});

export const RestoreFieldTrashStreamRoute: RouteConfig = registerRoute({
  method: 'post',
  path: RESTORE_FIELD_TRASH_STREAM,
  summary: 'Restore field trash with SSE progress',
  description: 'Restore deleted fields and stream realtime v2 record value progress.',
  request: {
    params: z.object({
      trashId: z.string(),
    }),
    query: z.object({
      tableId: z.string().optional(),
    }),
  },
  responses: {
    201: {
      description: 'SSE stream with restore progress events and final status',
    },
  },
  tags: ['space'],
});

export const restoreTrash = async (trashId: string, tableId?: string) => {
  return axios.post(
    urlBuilder(RESTORE_TRASH, {
      trashId,
    }),
    undefined,
    { params: { tableId } }
  );
};

export const restoreFieldTrashStream = async (
  trashId: string,
  tableId?: string,
  options?: {
    onProgress?: (event: IRestoreFieldTrashStreamProgressEvent) => void;
    onError?: (event: IRestoreFieldTrashStreamErrorEvent) => void;
    signal?: AbortSignal;
    headers?: RequestInit['headers'];
  }
): Promise<{
  done: IRestoreFieldTrashStreamDoneEvent;
  errors: IRestoreFieldTrashStreamErrorEvent[];
}> => {
  const url = axios.getUri({
    baseURL: axios.defaults.baseURL || '/api',
    url: urlBuilder(RESTORE_FIELD_TRASH_STREAM, {
      trashId,
    }),
    params: { tableId },
  });

  let doneEvent: IRestoreFieldTrashStreamDoneEvent | null = null;
  const errors: IRestoreFieldTrashStreamErrorEvent[] = [];

  await streamSSE<IRestoreFieldTrashStreamEvent>(
    url,
    {
      method: 'POST',
      signal: options?.signal,
      headers: options?.headers,
    },
    {
      errorPrefix: 'Restore field trash stream failed',
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
    throw new Error('Restore field trash stream ended without result');
  }

  return { done: doneEvent, errors };
};
