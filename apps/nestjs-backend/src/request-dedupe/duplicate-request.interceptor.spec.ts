/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import Keyv from 'keyv';
import type { ClsService } from 'nestjs-cls';
import { from, lastValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheService } from '../cache/cache.service';
import type { IClsStore } from '../types/cls';
import { DuplicateRequestInterceptor } from './duplicate-request.interceptor';
import { PreventDuplicateRequest } from './prevent-duplicate-request.decorator';

class DepartmentController {
  @PreventDuplicateRequest()
  createDepartment() {}

  getDepartment() {}
}

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('DuplicateRequestInterceptor', () => {
  let userId: string | undefined;
  let cacheService: CacheService;
  let interceptor: DuplicateRequestInterceptor;

  const contextOf = ({
    handler = DepartmentController.prototype.createDepartment,
    params = { organizationId: 'orgA' },
    query = {},
    body = { name: 'Sales' } as unknown,
  } = {}) =>
    ({
      getClass: () => DepartmentController,
      getHandler: () => handler,
      switchToHttp: () => ({ getRequest: () => ({ params, query, body }) }),
    }) as unknown as ExecutionContext;

  const run = (context: ExecutionContext, result: Promise<unknown> | unknown = 'created') =>
    interceptor
      .intercept(context, {
        handle: () => (result instanceof Promise ? from(result) : of(result)),
      })
      .then((observable) => lastValueFrom(observable));

  const tooManyRequests = {
    code: 'too_many_requests',
    data: { localization: { i18nKey: 'httpErrors.tooManyRequests' } },
  };

  beforeEach(() => {
    userId = 'usrA';
    // The two Redis commands the interceptor's lock runs on: SET NX to take the slot, and the
    // release script, which deletes the key only while it still holds this request's token.
    const keys = new Map<string, string>();
    const redis = {
      set: vi.fn(async (key: string, value: string) => {
        if (keys.has(key)) return null;
        keys.set(key, value);
        return 'OK';
      }),
      eval: vi.fn(async (_script: string, _keyCount: number, key: string, token: string) => {
        const raw = keys.get(key);
        if (!raw || JSON.parse(raw).value !== token) return 0;
        keys.delete(key);
        return 1;
      }),
    };
    const keyv = { opts: { namespace: 'teable_cache', store: { redis } } };
    cacheService = new CacheService(keyv as unknown as Keyv<any>);
    const cls = { get: vi.fn(() => userId) } as unknown as ClsService<IClsStore>;
    interceptor = new DuplicateRequestInterceptor(new Reflector(), cls, cacheService);
  });

  it('answers 429 to a repeat of a request that is still being processed', async () => {
    const first = deferred<string>();
    const firstResult = run(contextOf(), first.promise);

    const repeat = run(contextOf());
    await expect(repeat).rejects.toMatchObject(tooManyRequests);
    await expect(repeat.catch((error) => error.getStatus())).resolves.toBe(429);

    first.resolve('created');
    await expect(firstResult).resolves.toBe('created');
  });

  it('lets the same request through again once the first has finished', async () => {
    await expect(run(contextOf())).resolves.toBe('created');
    await expect(run(contextOf())).resolves.toBe('created');
  });

  it('lets the same request through again after the first failed', async () => {
    await expect(
      interceptor
        .intercept(contextOf(), { handle: () => throwError(() => new Error('insert failed')) })
        .then((observable) => lastValueFrom(observable))
    ).rejects.toThrow('insert failed');

    await expect(run(contextOf())).resolves.toBe('created');
  });

  it('treats body key order as the same request', async () => {
    const first = deferred<string>();
    const firstResult = run(
      contextOf({ body: { name: 'Sales', parentId: 'odpA' } }),
      first.promise
    );

    await expect(
      run(contextOf({ body: { parentId: 'odpA', name: 'Sales' } }))
    ).rejects.toMatchObject(tooManyRequests);

    first.resolve('created');
    await firstResult;
  });

  it.each([
    ['another body', contextOf({ body: { name: 'Marketing' } })],
    ['other params', contextOf({ params: { organizationId: 'orgB' } })],
    ['another query', contextOf({ query: { dryRun: 'true' } })],
  ])('lets a request with %s through while the first is in flight', async (_case, other) => {
    const first = deferred<string>();
    const firstResult = run(contextOf(), first.promise);

    await expect(run(other)).resolves.toBe('created');

    first.resolve('created');
    await firstResult;
  });

  it('lets the same request from another user through', async () => {
    const first = deferred<string>();
    const firstResult = run(contextOf(), first.promise);

    userId = 'usrB';
    await expect(run(contextOf())).resolves.toBe('created');

    first.resolve('created');
    await firstResult;
  });

  it('does nothing for handlers without the decorator or requests without a user', async () => {
    const setnx = vi.spyOn(cacheService, 'setnx');

    await expect(
      run(contextOf({ handler: DepartmentController.prototype.getDepartment }))
    ).resolves.toBe('created');
    userId = undefined;
    await expect(run(contextOf())).resolves.toBe('created');

    expect(setnx).not.toHaveBeenCalled();
  });

  it('lets requests through when the cache store fails', async () => {
    vi.spyOn(cacheService, 'setnx').mockRejectedValue(new Error('redis down'));

    await expect(run(contextOf())).resolves.toBe('created');
    await expect(run(contextOf())).resolves.toBe('created');
  });
});
