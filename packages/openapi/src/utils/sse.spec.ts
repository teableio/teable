import { HttpError, HttpErrorCode } from '@teable/core';
import { AxiosHeaders } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { axios } from '../axios';
import { buildSSERequestHeaders, streamSSE, toSSERequestError } from './sse';

describe('buildSSERequestHeaders', () => {
  const acceptHeader = 'text/event-stream';
  const authorizationHeader = 'Bearer token';
  const originalCommon = axios.defaults.headers.common;
  const originalGet = axios.defaults.headers.get;
  const originalPost = axios.defaults.headers.post;
  const originalPatch = axios.defaults.headers.patch;

  afterEach(() => {
    axios.defaults.headers.common = originalCommon;
    axios.defaults.headers.get = originalGet;
    axios.defaults.headers.post = originalPost;
    axios.defaults.headers.patch = originalPatch;
  });

  it('merges only common and get defaults plus request headers', () => {
    axios.defaults.headers.common = {
      Authorization: authorizationHeader,
      'X-Common': 'common',
      nested: { leak: 'nope' },
    } as never;
    axios.defaults.headers.get = {
      'X-Get': 'get',
      nonString: 42,
    } as never;
    axios.defaults.headers.post = {
      'X-Post': 'post',
    } as never;

    const headers = buildSSERequestHeaders(undefined, {
      'X-Request': 'request',
      'X-Common': 'request-wins',
    });

    expect(headers).toEqual({
      Accept: acceptHeader,
      Authorization: authorizationHeader,
      'X-Common': 'request-wins',
      'X-Get': 'get',
      'X-Request': 'request',
    });
  });

  it('preserves axios default headers stored as AxiosHeaders instances', () => {
    const common = new AxiosHeaders();
    common.set('Authorization', authorizationHeader);
    common.set('X-Window-Id', 'win_stream_delete');

    const get = new AxiosHeaders();
    get.set('X-Canary', 'true');

    axios.defaults.headers.common = common as never;
    axios.defaults.headers.get = get as never;
    axios.defaults.headers.post = new AxiosHeaders() as never;

    const headers = buildSSERequestHeaders();

    expect(headers).toEqual({
      Accept: acceptHeader,
      Authorization: authorizationHeader,
      'X-Canary': 'true',
      'X-Window-Id': 'win_stream_delete',
    });
  });

  it('merges method-specific patch defaults when a non-get SSE request is used', () => {
    axios.defaults.headers.common = {
      Authorization: authorizationHeader,
    } as never;
    axios.defaults.headers.get = {} as never;
    axios.defaults.headers.patch = {
      'X-Patch': 'patch',
    } as never;

    const headers = buildSSERequestHeaders('PATCH', {
      'X-Request': 'request',
    });

    expect(headers).toEqual({
      Accept: acceptHeader,
      Authorization: authorizationHeader,
      'X-Patch': 'patch',
      'X-Request': 'request',
    });
  });
});

describe('toSSERequestError', () => {
  it('preserves the backend error envelope for JSON bodies', () => {
    const body = JSON.stringify({
      message: 'Exceed the maximum number of rows',
      status: 402,
      code: HttpErrorCode.PAYMENT_REQUIRED,
      data: { localization: { i18nKey: 'httpErrors.billing.exceedMaxRowLimit' } },
    });

    const error = toSSERequestError(body, 402, 'Paste selection by id stream failed');

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(402);
    expect(error.code).toBe(HttpErrorCode.PAYMENT_REQUIRED);
    expect(error.message).toBe('Exceed the maximum number of rows');
    expect(error.data).toEqual({
      localization: { i18nKey: 'httpErrors.billing.exceedMaxRowLimit' },
    });
  });

  it('falls back to a prefixed message for non-JSON bodies', () => {
    const error = toSSERequestError('Bad Gateway', 502, 'SSE stream failed');

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(502);
    expect(error.message).toBe('SSE stream failed: 502 Bad Gateway');
  });

  it('falls back to a prefixed message for JSON bodies without a message', () => {
    const error = toSSERequestError('{"foo":"bar"}', 500, 'SSE stream failed');

    expect(error.status).toBe(500);
    expect(error.message).toBe('SSE stream failed: 500 {"foo":"bar"}');
  });
});

describe('streamSSE', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws an HttpError carrying status and code when the request fails before streaming', async () => {
    const body = JSON.stringify({
      message: 'Exceed the maximum number of rows',
      status: 402,
      code: HttpErrorCode.PAYMENT_REQUIRED,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 402 })));

    const error: unknown = await streamSSE(
      '/api/table/tbl/selection/paste-by-id-stream',
      { method: 'PATCH' },
      { errorPrefix: 'Paste selection by id stream failed' }
    ).catch((e) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(402);
    expect((error as HttpError).code).toBe(HttpErrorCode.PAYMENT_REQUIRED);
    expect((error as HttpError).message).toBe('Exceed the maximum number of rows');
  });

  it('waits for the async consumer before delivering another result or pulling another chunk', async () => {
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const encoder = new TextEncoder();
    const delivered: number[] = [];
    const applied: number[] = [];
    const producedChunks: number[] = [];
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const chunk = producedChunks.length;
          producedChunks.push(chunk);
          if (chunk === 0) {
            controller.enqueue(
              encoder.encode(
                'data: {"id":"progress","sequence":0}\n\n' +
                  'data: {"id":"progress","sequence":1}\n\n'
              )
            );
          } else {
            controller.enqueue(encoder.encode('data: {"id":"done","sequence":2}\n\n'));
            controller.close();
          }
        },
      },
      { highWaterMark: 0 }
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));

    const consuming = streamSSE<{ id: string; sequence: number }>(
      '/stream',
      {},
      {
        async onResult(result) {
          delivered.push(result.sequence);
          if (result.sequence === 0) {
            entered.resolve();
            await resume.promise;
          }
          applied.push(result.sequence);
        },
      }
    );
    try {
      await entered.promise;
      expect(delivered).toEqual([0]);
      expect(applied).toEqual([]);
      expect(producedChunks).toEqual([0]);
    } finally {
      resume.resolve();
      await consuming;
    }
    expect(delivered).toEqual([0, 1, 2]);
    expect(applied).toEqual([0, 1, 2]);
    expect(body.locked).toBe(false);
  });

  it.each(['error', 'done'])(
    'stops at an opted-in %s result and releases the live source',
    async (id) => {
      let subscribed = true;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ id })}\n\n` + 'data: {"id":"unexpected"}\n\n'
            )
          );
        },
        async cancel() {
          await Promise.resolve();
          subscribed = false;
        },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
      const results: string[] = [];

      await streamSSE(
        '/stream',
        {},
        {
          terminalResultIds: ['error', 'done'],
          onResult(result) {
            results.push(result.id);
          },
        }
      );

      expect(results).toEqual([id]);
      expect(subscribed).toBe(false);
      expect(body.locked).toBe(false);
    }
  );

  it.each(['sync', 'async'])(
    'propagates %s consumer SyntaxErrors and still cleans up a failing source cancellation',
    async (mode) => {
      const error = new SyntaxError('consumer failed');
      let subscribed = true;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"id":"progress"}\n\n'));
        },
        cancel() {
          subscribed = false;
          return Promise.reject(new Error('cancel failed'));
        },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));

      await expect(
        streamSSE(
          '/stream',
          {},
          {
            onResult() {
              if (mode === 'async') return Promise.reject(error);
              throw error;
            },
          }
        )
      ).rejects.toBe(error);

      expect(subscribed).toBe(false);
      expect(body.locked).toBe(false);
    }
  );

  it('releases the reader when reading the response body fails', async () => {
    const error = new Error('connection failed');
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(error);
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));

    await expect(streamSSE('/stream', {})).rejects.toBe(error);
    expect(body.locked).toBe(false);
  });

  it('preserves default ignored IDs, malformed-line tolerance, and nonterminal error results', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            ': ping\n\n' +
              'data: {"id":"connect"}\n\n' +
              'data: not-json\n\n' +
              'data: {"id":"error"}\n\n' +
              'data: {"id":"progress"}\n\n' +
              'data: {"id":"complete"}\n\n' +
              'data: {"id":"done"}'
          )
        );
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    const results: string[] = [];

    await streamSSE(
      '/stream',
      {},
      {
        onResult(result) {
          results.push(result.id);
        },
      }
    );

    expect(results).toEqual(['error', 'progress', 'done']);
    expect(body.locked).toBe(false);
  });
});
