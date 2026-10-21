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
});
