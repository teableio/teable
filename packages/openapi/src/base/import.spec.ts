import { afterEach, describe, expect, it, vi } from 'vitest';
import { importBaseStream } from './import';

const createSSEStreamResponse = (chunks: string[]) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
};

describe('importBaseStream', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses final done event without trailing newline', async () => {
    const donePayload = {
      type: 'done',
      data: {
        base: { id: 'base_1' },
        tableIdMap: {},
        fieldIdMap: {},
        viewIdMap: {},
      },
    };

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          createSSEStreamResponse([
            'data: {"type":"progress","phase":"importing"}\n',
            `data: ${JSON.stringify(donePayload)}`,
          ])
        )
    );

    const result = await importBaseStream({} as never);
    expect(result.data).toEqual(donePayload.data);
  });

  it('throws when stream ends without done event', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          createSSEStreamResponse(['data: {"type":"progress","phase":"importing"}\n'])
        )
    );

    await expect(importBaseStream({} as never)).rejects.toThrow(
      'Import base stream ended without result'
    );
  });
});
