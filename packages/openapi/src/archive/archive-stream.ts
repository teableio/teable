import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { streamSSE } from '../utils/sse';
import { z } from '../zod';
import { archiveRecordIdSchema } from './archive';

export const ARCHIVE_RECORDS_STREAM = '/table/{tableId}/record/archive-stream';

// Same body as the plain endpoint but uncapped — the stream endpoint exists for the
// requests the plain endpoint's max would reject.
export const archiveStreamRoSchema = z.object({
  recordIds: z.array(archiveRecordIdSchema).min(1),
});

export type IArchiveStreamRo = z.infer<typeof archiveStreamRoSchema>;

export const archiveStreamProgressEventSchema = z.object({
  id: z.literal('progress'),
  phase: z.enum(['preparing', 'archiving']),
  batchIndex: z.number(),
  totalCount: z.number(),
  archivedCount: z.number(),
  batchArchivedCount: z.number(),
});

export const archiveStreamDoneEventSchema = z.object({
  id: z.literal('done'),
  totalCount: z.number(),
  archivedCount: z.number(),
  archivedRecordIds: z.array(z.string()),
});

export const archiveStreamErrorEventSchema = z.object({
  id: z.literal('error'),
  message: z.string(),
  code: z.string().optional(),
});

export const archiveStreamEventSchema = z.union([
  archiveStreamProgressEventSchema,
  archiveStreamDoneEventSchema,
  archiveStreamErrorEventSchema,
]);

export type IArchiveStreamProgressEvent = z.infer<typeof archiveStreamProgressEventSchema>;
export type IArchiveStreamDoneEvent = z.infer<typeof archiveStreamDoneEventSchema>;
export type IArchiveStreamErrorEvent = z.infer<typeof archiveStreamErrorEventSchema>;
export type IArchiveStreamEvent = z.infer<typeof archiveStreamEventSchema>;

export const ArchiveRecordsStreamRoute = registerRoute({
  method: 'post',
  path: ARCHIVE_RECORDS_STREAM,
  summary: 'Archive records with SSE progress',
  request: {
    params: z.object({ tableId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: archiveStreamRoSchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'SSE stream with archive progress events and final result' },
  },
  tags: ['archive'],
});

export const archiveRecordsStream = async (
  tableId: string,
  archiveRo: IArchiveStreamRo,
  options?: {
    onProgress?: (event: IArchiveStreamProgressEvent) => void;
    onError?: (event: IArchiveStreamErrorEvent) => void;
    signal?: AbortSignal;
    headers?: RequestInit['headers'];
  }
): Promise<{
  done: IArchiveStreamDoneEvent;
  errors: IArchiveStreamErrorEvent[];
}> => {
  const url = axios.getUri({
    baseURL: axios.defaults.baseURL || '/api',
    url: urlBuilder(ARCHIVE_RECORDS_STREAM, { tableId }),
  });

  let doneEvent: IArchiveStreamDoneEvent | null = null;
  const errors: IArchiveStreamErrorEvent[] = [];

  await streamSSE<IArchiveStreamEvent>(
    url,
    {
      method: 'POST',
      signal: options?.signal,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      body: JSON.stringify(archiveRo),
    },
    {
      errorPrefix: 'Archive records stream failed',
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
    throw new Error('Archive records stream ended without result');
  }

  return { done: doneEvent, errors };
};
