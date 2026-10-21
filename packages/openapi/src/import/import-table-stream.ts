import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { streamSSE } from '../utils/sse';
import { z } from '../zod';
import {
  finishImportStream,
  reduceImportStreamEvent,
  type IImportStreamClientResult,
  type IImportStreamDoneEvent,
  type IImportStreamErrorEvent,
  type IImportStreamEvent,
  type IImportStreamProgressEvent,
} from './import-stream';
import { IMPORT_TABLE } from './import-table';
import { importOptionRoSchema, type IImportOptionRo } from './types';

export const IMPORT_TABLE_STREAM = `${IMPORT_TABLE}/stream`;

export const ImportTableFromFileStreamRoute = registerRoute({
  method: 'post',
  path: IMPORT_TABLE_STREAM,
  summary: 'Create tables from a file with SSE progress',
  description:
    'Create one table per worksheet and stream realtime import progress for each committed row batch.',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: importOptionRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'SSE stream with import progress events and the created tables',
    },
  },
  tags: ['import'],
});

export const importTableFromFileStream = async (
  baseId: string,
  importRo: IImportOptionRo,
  options?: {
    onProgress?: (event: IImportStreamProgressEvent) => void;
    onError?: (event: IImportStreamErrorEvent) => void;
    signal?: AbortSignal;
    headers?: RequestInit['headers'];
  }
): Promise<IImportStreamClientResult> => {
  const url = axios.getUri({
    baseURL: axios.defaults.baseURL || '/api',
    url: urlBuilder(IMPORT_TABLE_STREAM, { baseId }),
  });

  let doneEvent: IImportStreamDoneEvent | null = null;
  const errors: IImportStreamErrorEvent[] = [];

  await streamSSE<IImportStreamEvent>(
    url,
    {
      method: 'POST',
      signal: options?.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: JSON.stringify(importRo),
    },
    {
      errorPrefix: 'Import table stream failed',
      onResult: (result) => {
        const reduced = reduceImportStreamEvent(result, options);
        if (reduced.done) {
          doneEvent = reduced.done;
        }
        if (reduced.error) {
          errors.push(reduced.error);
        }
      },
    }
  );

  return finishImportStream(doneEvent, errors, 'Import table stream ended without result');
};
