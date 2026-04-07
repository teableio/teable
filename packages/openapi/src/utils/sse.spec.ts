import { AxiosHeaders } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';

import { axios } from '../axios';
import { buildSSERequestHeaders } from './sse';

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
