import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { streamSSE } from '../utils/sse';
import { z } from '../zod';

export const ARCHIVE_EXPORT_STREAM = '/table/{tableId}/archive/export-stream';

// Same filter dimensions as the archive list (order is fixed archivedTime desc);
// POST body, so arrays are plain — no query-string coercion needed.
export const archiveExportStreamRoSchema = z.object({
  recordCreatedBy: z.array(z.string()).optional(),
  recordLastModifiedBy: z.array(z.string()).optional(),
  archivedTimeStart: z.string().optional(),
  archivedTimeEnd: z.string().optional(),
  recordCreatedTimeStart: z.string().optional(),
  recordCreatedTimeEnd: z.string().optional(),
});

export type IArchiveExportStreamRo = z.infer<typeof archiveExportStreamRoSchema>;

export const archiveExportProgressEventSchema = z.object({
  id: z.literal('progress'),
  processedCount: z.number(),
});

export const archiveExportDoneEventSchema = z.object({
  id: z.literal('done'),
  rowCount: z.number(),
  fileName: z.string(),
  downloadUrl: z.string(),
});

export const archiveExportErrorEventSchema = z.object({
  id: z.literal('error'),
  message: z.string(),
  code: z.string().optional(),
});

export const archiveExportStreamEventSchema = z.union([
  archiveExportProgressEventSchema,
  archiveExportDoneEventSchema,
  archiveExportErrorEventSchema,
]);

export type IArchiveExportProgressEvent = z.infer<typeof archiveExportProgressEventSchema>;
export type IArchiveExportDoneEvent = z.infer<typeof archiveExportDoneEventSchema>;
export type IArchiveExportErrorEvent = z.infer<typeof archiveExportErrorEventSchema>;
export type IArchiveExportStreamEvent = z.infer<typeof archiveExportStreamEventSchema>;

export const ArchiveExportStreamRoute = registerRoute({
  method: 'post',
  path: ARCHIVE_EXPORT_STREAM,
  summary: 'Export archived records as CSV with SSE progress',
  request: {
    params: z.object({ tableId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: archiveExportStreamRoSchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'SSE stream with export progress events and a final download url' },
  },
  tags: ['archive'],
});

export const exportArchiveRecordsStream = async (
  tableId: string,
  exportRo: IArchiveExportStreamRo,
  options?: {
    onProgress?: (event: IArchiveExportProgressEvent) => void;
    signal?: AbortSignal;
    headers?: RequestInit['headers'];
  }
): Promise<IArchiveExportDoneEvent> => {
  const url = axios.getUri({
    baseURL: axios.defaults.baseURL || '/api',
    url: urlBuilder(ARCHIVE_EXPORT_STREAM, { tableId }),
  });

  let doneEvent: IArchiveExportDoneEvent | null = null;
  const errors: IArchiveExportErrorEvent[] = [];

  await streamSSE<IArchiveExportStreamEvent>(
    url,
    {
      method: 'POST',
      signal: options?.signal,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      body: JSON.stringify(exportRo),
    },
    {
      errorPrefix: 'Archive export stream failed',
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
        }
      },
    }
  );

  if (!doneEvent) {
    const lastError = errors.at(-1);
    if (lastError) throw new Error(lastError.message);
    throw new Error('Archive export stream ended without result');
  }

  return doneEvent;
};
