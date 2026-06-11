import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import type { ICreateBaseVo } from './create';
import { createBaseVoSchema } from './create';

/**
 * Defines the mode of base duplication operation.
 * Different modes control how the base is duplicated and what transformations are applied.
 */
export enum BaseDuplicateMode {
  /**
   * Normal base duplication - all features are preserved as-is
   */
  Normal = 'normal',

  /**
   * Creating a template snapshot - automations and other dynamic features are disabled
   */
  CreateTemplate = 'createTemplate',

  /**
   * Applying a template - user emails in automations are replaced with the current user's email
   */
  ApplyTemplate = 'applyTemplate',

  /**
   * Copying a shared base - similar to CreateTemplate, cross-base links are disconnected
   */
  CopyShareBase = 'copyShareBase',
}

export const DUPLICATE_BASE = '/base/duplicate';
export const DUPLICATE_BASE_STREAM = '/base/duplicate-stream';

export const duplicateBaseRoSchema = z.object({
  fromBaseId: z.string().meta({
    description: 'The base to duplicate',
  }),
  spaceId: z.string().meta({
    description: 'The space to duplicate the base to',
  }),
  withRecords: z.boolean().optional().meta({
    description: 'Whether to duplicate the records',
  }),
  name: z.string().optional().meta({
    description: 'The name of the duplicated base',
  }),
  baseId: z.string().optional(),
  nodes: z.array(z.string()).optional().meta({
    description: 'The node IDs to include in the duplication',
  }),
  shareId: z.string().optional().meta({
    description:
      'The share ID when duplicating from a shared base. If provided, will use share permissions instead of base|update permission.',
  }),
});

export type IDuplicateBaseRo = z.infer<typeof duplicateBaseRoSchema>;

export interface IDuplicateBaseProgressEvent {
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

export type DuplicateBaseProgressCallback = (
  phase: string,
  detail?: string,
  event?: IDuplicateBaseProgressEvent
) => void;

export type IDuplicateBaseSSEEvent =
  | IDuplicateBaseProgressEvent
  | { type: 'done'; data: ICreateBaseVo }
  | { type: 'error'; message: string };

export const DuplicateBaseRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DUPLICATE_BASE,
  description: 'duplicate a base',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: duplicateBaseRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns information about a successfully duplicated base.',
      content: {
        'application/json': {
          schema: createBaseVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const DuplicateBaseStreamRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DUPLICATE_BASE_STREAM,
  description: 'duplicate a base with SSE progress stream',
  request: {
    body: {
      content: {
        'application/json': {
          schema: duplicateBaseRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'SSE stream with progress events and final duplicated base.',
    },
  },
  tags: ['base'],
});

export const duplicateBase = async (params: IDuplicateBaseRo) => {
  return axios.post<ICreateBaseVo>(DUPLICATE_BASE, params);
};

const buildSSERequestHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
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
  event: IDuplicateBaseSSEEvent,
  onProgress?: DuplicateBaseProgressCallback
): ICreateBaseVo | undefined => {
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

const parseSSELine = (line: string): IDuplicateBaseSSEEvent | undefined => {
  if (!line.startsWith('data: ')) return undefined;
  const jsonStr = line.slice(6).trim();
  if (!jsonStr || jsonStr === '[DONE]') return undefined;
  return JSON.parse(jsonStr) as IDuplicateBaseSSEEvent;
};

const processSSELine = (
  line: string,
  onProgress?: DuplicateBaseProgressCallback
): ICreateBaseVo | undefined => {
  try {
    const event = parseSSELine(line);
    if (!event) return undefined;
    return handleSSEEvent(event, onProgress);
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    return undefined;
  }
};

const readSSEStream = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onProgress?: DuplicateBaseProgressCallback
): Promise<ICreateBaseVo | null> => {
  const decoder = new TextDecoder();
  let buffer = '';
  let result: ICreateBaseVo | null = null;

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

  buffer += decoder.decode();
  if (buffer.trim()) {
    result = processSSELine(buffer, onProgress) ?? result;
  }

  return result;
};

export const duplicateBaseStream = async (
  params: IDuplicateBaseRo,
  onProgress?: DuplicateBaseProgressCallback
): Promise<{ data: ICreateBaseVo }> => {
  const baseURL = axios.defaults.baseURL || '/api';
  const url = `${baseURL}${DUPLICATE_BASE_STREAM}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: buildSSERequestHeaders(),
    credentials: 'include',
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Duplicate base failed: ${response.status} ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body for SSE stream');
  }

  const result = await readSSEStream(reader, onProgress);
  if (!result) {
    throw new Error('Duplicate base stream ended without result');
  }

  return { data: result };
};
