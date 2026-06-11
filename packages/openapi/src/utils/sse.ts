import { axios } from '../axios';

const defaultIgnoredResultIds = new Set(['connect', 'complete']);

const hasToJson = (headers: unknown): headers is { toJSON: () => unknown } =>
  typeof headers === 'object' &&
  headers != null &&
  'toJSON' in headers &&
  typeof (headers as { toJSON?: unknown }).toJSON === 'function';

const toHeaderRecord = (
  headers?: RequestInit['headers'] | Record<string, unknown>
): Record<string, string> => {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  if (hasToJson(headers)) {
    return toHeaderRecord(headers.toJSON() as Record<string, unknown>);
  }

  return Object.fromEntries(
    Object.entries(headers).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
};

export const buildSSERequestHeaders = (
  method?: string,
  headers?: RequestInit['headers']
): Record<string, string> => {
  const resolvedMethod = method?.toLowerCase() ?? 'get';
  const methodHeaders =
    resolvedMethod in axios.defaults.headers
      ? toHeaderRecord(
          (axios.defaults.headers as Record<string, unknown>)[resolvedMethod] as
            | RequestInit['headers']
            | Record<string, unknown>
            | undefined
        )
      : {};

  return {
    ...toHeaderRecord(axios.defaults.headers.common),
    ...methodHeaders,
    Accept: 'text/event-stream',
    ...toHeaderRecord(headers),
  };
};

export const parseSSELine = <T>(line: string): T | undefined => {
  if (!line.startsWith('data:')) {
    return undefined;
  }

  const jsonStr = line.slice(5).trim();
  if (!jsonStr || jsonStr === '[DONE]') {
    return undefined;
  }

  return JSON.parse(jsonStr) as T;
};

export const readSSEStream = async <T extends { id: string }>(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options?: {
    onResult?: (result: T) => void;
    ignoredResultIds?: Iterable<string>;
  }
): Promise<void> => {
  const decoder = new TextDecoder();
  const ignoredResultIds = new Set(options?.ignoredResultIds ?? defaultIgnoredResultIds);
  let buffer = '';

  const processBufferLine = (line: string) => {
    try {
      const result = parseSSELine<T>(line);
      if (!result || ignoredResultIds.has(result.id)) {
        return;
      }
      options?.onResult?.(result);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return;
      }
      throw error;
    }
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      processBufferLine(line);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    processBufferLine(buffer);
  }
};

export const streamSSE = async <T extends { id: string }>(
  input: string,
  init: RequestInit,
  options?: {
    onResult?: (result: T) => void;
    ignoredResultIds?: Iterable<string>;
    errorPrefix?: string;
  }
): Promise<void> => {
  const response = await fetch(input, {
    ...init,
    credentials: 'include',
    headers: buildSSERequestHeaders(init.method, init.headers),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const errorPrefix = options?.errorPrefix ?? 'SSE stream failed';
    throw new Error(`${errorPrefix}: ${response.status} ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body for SSE stream');
  }

  await readSSEStream(reader, {
    onResult: options?.onResult,
    ignoredResultIds: options?.ignoredResultIds,
  });
};
