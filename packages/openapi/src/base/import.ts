import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { notifyVoSchema } from '../attachment';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { createBaseVoSchema } from './create';

export const IMPORT_BASE = '/base/import';
export const IMPORT_BASE_STREAM = '/base/import-stream';

export const importBaseVoSchema = z.object({
  base: createBaseVoSchema,
  tableIdMap: z.record(z.string(), z.string()),
  fieldIdMap: z.record(z.string(), z.string()),
  viewIdMap: z.record(z.string(), z.string()),
});

export type IImportBaseVo = z.infer<typeof importBaseVoSchema>;

export const importBaseRoSchema = z.object({
  notify: notifyVoSchema,
  spaceId: z.string(),
});

export type ImportBaseRo = z.infer<typeof importBaseRoSchema>;

export interface IImportBaseProgressEvent {
  type: 'progress';
  phase: string;
  detail?: string;
  tableId?: string;
  tableName?: string;
  tableIndex?: number;
  totalTables?: number;
  totalRows?: number;
  processedRows?: number;
  batchProcessedRows?: number;
  currentBatch?: number;
}

export type ImportBaseProgressCallback = (
  phase: string,
  detail?: string,
  event?: IImportBaseProgressEvent
) => void;

// SSE event types for import base progress
export type IImportBaseSSEEvent =
  | IImportBaseProgressEvent
  | { type: 'done'; data: IImportBaseVo }
  | { type: 'error'; message: string };

export const ImportBaseRoute: RouteConfig = registerRoute({
  method: 'post',
  path: IMPORT_BASE,
  description: 'import a base',
  summary: 'import a base',
  request: {
    body: {
      content: {
        'application/json': {
          schema: importBaseRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'import successfully',
    },
  },
  tags: ['base'],
});

export const ImportBaseStreamRoute: RouteConfig = registerRoute({
  method: 'post',
  path: IMPORT_BASE_STREAM,
  description: 'import a base with SSE progress stream',
  summary: 'import a base with SSE progress events',
  request: {
    body: {
      content: {
        'application/json': {
          schema: importBaseRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'SSE stream with progress events and final result',
    },
  },
  tags: ['base'],
});

/**
 * Import a base (standard JSON response).
 */
export const importBase = async (importBaseRo: ImportBaseRo) => {
  return await axios.post<IImportBaseVo>(urlBuilder(IMPORT_BASE), importBaseRo);
};

const buildSSERequestHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  for (const name of ['Authorization', 'Cookie']) {
    const value = axios.defaults.headers.common?.[name];
    if (value && typeof value === 'string') {
      headers[name] = value;
    }
  }
  return headers;
};

const handleSSEEvent = (
  event: IImportBaseSSEEvent,
  onProgress?: ImportBaseProgressCallback
): IImportBaseVo | undefined => {
  switch (event.type) {
    case 'progress':
      onProgress?.(event.phase, event.detail, event);
      return undefined;
    case 'done':
      return event.data;
    case 'error':
      throw new Error(event.message);
  }
};

const parseSSELine = (line: string): IImportBaseSSEEvent | undefined => {
  if (!line.startsWith('data: ')) return undefined;
  const jsonStr = line.slice(6).trim();
  if (!jsonStr || jsonStr === '[DONE]') return undefined;
  return JSON.parse(jsonStr) as IImportBaseSSEEvent;
};

const processSSELine = (
  line: string,
  onProgress?: ImportBaseProgressCallback
): IImportBaseVo | undefined => {
  try {
    const event = parseSSELine(line);
    if (!event) return undefined;
    return handleSSEEvent(event, onProgress);
  } catch (e) {
    // Re-throw stream domain errors, only ignore malformed JSON chunks.
    if (!(e instanceof SyntaxError)) throw e;
    return undefined;
  }
};

const readSSEStream = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onProgress?: ImportBaseProgressCallback
): Promise<IImportBaseVo | null> => {
  const decoder = new TextDecoder();
  let buffer = '';
  let result: IImportBaseVo | null = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      result = processSSELine(line, onProgress) ?? result;
    }
  }

  // Flush decoder and process the final buffered line.
  // Some proxies/servers may end the stream without a trailing newline,
  // leaving the last event stuck in `buffer` after the while-loop exits.
  buffer += decoder.decode();
  if (buffer.trim()) {
    result = processSSELine(buffer, onProgress) ?? result;
  }

  return result;
};

/**
 * Import a base with SSE progress streaming.
 * Uses fetch API to handle text/event-stream response.
 * @param importBaseRo - Import base request object
 * @param onProgress - Callback for progress events (phase + optional detail)
 * @returns Promise that resolves with the final import result
 */
export const importBaseStream = async (
  importBaseRo: ImportBaseRo,
  onProgress?: ImportBaseProgressCallback,
  onV2Change?: (isV2: boolean) => void
): Promise<{ data: IImportBaseVo }> => {
  const baseURL = axios.defaults.baseURL || '/api';
  const url = `${baseURL}${urlBuilder(IMPORT_BASE_STREAM)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: buildSSERequestHeaders(),
    body: JSON.stringify(importBaseRo),
    credentials: 'include',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Import base failed: ${response.status} ${errorText}`);
  }

  onV2Change?.(response.headers.get('x-teable-v2') === 'true');

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body for SSE stream');
  }

  const result = await readSSEStream(reader, onProgress);
  if (!result) {
    throw new Error('Import base stream ended without result');
  }

  return { data: result };
};
