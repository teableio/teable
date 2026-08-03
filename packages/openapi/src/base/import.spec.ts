import { afterEach, describe, expect, it, vi } from 'vitest';
import { importBaseStream } from './import';

const IMPORTING_PROGRESS_EVENT = 'data: {"type":"progress","phase":"importing"}\n';

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
            IMPORTING_PROGRESS_EVENT,
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
      vi.fn().mockResolvedValue(createSSEStreamResponse([IMPORTING_PROGRESS_EVENT]))
    );

    await expect(importBaseStream({} as never)).rejects.toThrow(
      'Import base stream ended without result'
    );
  });

  it('throws SSE error events even when the message starts with Unexpected', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          createSSEStreamResponse([
            IMPORTING_PROGRESS_EVENT,
            'data: {"type":"error","message":"Unexpected unit of work error: connection lost"}\n',
          ])
        )
    );

    await expect(importBaseStream({} as never)).rejects.toThrow(
      'Unexpected unit of work error: connection lost'
    );
  });

  it('notifies when response is routed to v2', async () => {
    const onV2Change = vi.fn();
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
      vi.fn().mockResolvedValue(
        new Response(`data: ${JSON.stringify(donePayload)}\n\n`, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream', 'x-teable-v2': 'true' },
        })
      )
    );

    await importBaseStream({} as never, undefined, onV2Change);
    expect(onV2Change).toHaveBeenCalledWith(true);
  });
});
