import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
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
import { INPLACE_IMPORT_TABLE } from './inplace-import-table';
import type { IInplaceImportOptionRo } from './types';
import { inplaceImportOptionRoSchema } from './types';

export const INPLACE_IMPORT_TABLE_STREAM = `${INPLACE_IMPORT_TABLE}/stream`;

export const inplaceImportTableFromFileStreamRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: INPLACE_IMPORT_TABLE_STREAM,
  summary: 'Import records into an existing table with SSE progress',
  description:
    'Append records from a file into an existing table and stream realtime import progress for each committed row batch.',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: inplaceImportOptionRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'SSE stream with import progress events and the imported row count',
    },
  },
  tags: ['import'],
});

export const inplaceImportTableFromFileStream = async (
  baseId: string,
  tableId: string,
  inplaceImportRo: IInplaceImportOptionRo,
  options?: {
    onProgress?: (event: IImportStreamProgressEvent) => void;
    onError?: (event: IImportStreamErrorEvent) => void;
    signal?: AbortSignal;
    headers?: RequestInit['headers'];
  }
): Promise<IImportStreamClientResult> => {
  const url = axios.getUri({
    baseURL: axios.defaults.baseURL || '/api',
    url: urlBuilder(INPLACE_IMPORT_TABLE_STREAM, { baseId, tableId }),
  });

  let doneEvent: IImportStreamDoneEvent | null = null;
  const errors: IImportStreamErrorEvent[] = [];

  await streamSSE<IImportStreamEvent>(
    url,
    {
      method: 'PATCH',
      signal: options?.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: JSON.stringify(inplaceImportRo),
    },
    {
      errorPrefix: 'Inplace import stream failed',
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

  return finishImportStream(doneEvent, errors, 'Inplace import stream ended without result');
};
