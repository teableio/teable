import { afterEach, describe, expect, it, vi } from 'vitest';
import { PapaparseCsvParser } from './PapaparseCsvParser';

const createCsvResponse = (chunks: string[]) => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'text/csv; charset=utf-8' },
  });
};

describe('PapaparseCsvParser', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not duplicate the final URL row when the CSV has no trailing newline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(createCsvResponse(['Name,Age\nAlice,30\nBob,40']))
    );

    const parser = new PapaparseCsvParser();
    const result = await parser.parseAsync({
      type: 'url',
      url: 'https://example.com/import.csv',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    const rows = [];
    for await (const row of result.value.rowsAsync ?? []) {
      rows.push(row);
    }

    expect(result.value.headers).toEqual(['Name', 'Age']);
    expect(rows).toEqual([
      { Name: 'Alice', Age: '30' },
      { Name: 'Bob', Age: '40' },
    ]);
  });
});
