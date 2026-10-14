import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';
import { createModelClient } from './openai.js';

const logger = createLogger('error', 'test');

const sseResponse = (chunks: string[]): Response => {
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
    headers: { 'content-type': 'text/event-stream' },
  });
};

const client = (fetchImpl: typeof fetch) =>
  createModelClient(
    {
      baseUrl: 'http://model.local/v1',
      apiKey: 'sk-test',
      model: 'test-model',
      temperature: 0,
      timeoutMs: 5_000,
    },
    logger,
    fetchImpl
  );

describe('createModelClient.streamChat', () => {
  it('parses text deltas, tool call chunks and finish reasons', async () => {
    const fetchImpl = (async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"query_records","arguments":"{\\"ta"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"bleId\\":\\"tbl1\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ])) as unknown as typeof fetch;

    const deltas = [];
    for await (const delta of client(fetchImpl).streamChat({
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      deltas.push(delta);
    }

    expect(deltas.filter((d) => d.text).map((d) => d.text)).toEqual(['Hel', 'lo']);
    const toolChunks = deltas.filter((d) => d.toolCallChunk).map((d) => d.toolCallChunk);
    expect(toolChunks[0]).toMatchObject({ index: 0, id: 'c1', name: 'query_records' });
    expect(toolChunks[1]).toMatchObject({ index: 0, argumentsDelta: 'bleId":"tbl1"}' });
    expect(deltas.some((d) => d.finishReason === 'tool_calls')).toBe(true);
  });

  it('sends model, stream, auth and tools in the request', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n',
      ]);
    }) as unknown as typeof fetch;

    for await (const _delta of client(fetchImpl).streamChat({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 't', description: 'd', parameters: {} } }],
    })) {
      // consume
    }

    expect(capturedUrl).toBe('http://model.local/v1/chat/completions');
    expect((capturedInit?.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    expect(body.model).toBe('test-model');
    expect(body.stream).toBe(true);
    expect(Array.isArray(body.tools)).toBe(true);
  });

  it('throws with the response body on HTTP errors', async () => {
    const fetchImpl = (async () =>
      new Response('{"error":"bad key"}', { status: 401 })) as unknown as typeof fetch;

    const consume = async () => {
      for await (const _delta of client(fetchImpl).streamChat({
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        // consume
      }
    };

    await expect(consume()).rejects.toThrow(/HTTP 401.*bad key/);
  });
});
