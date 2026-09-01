import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ClsService } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { IClsStore } from '../types/cls';
import { RequestInfoMiddleware } from './request-info.middleware';

const createRequest = (overrides: Partial<Request> = {}): Request =>
  ({
    headers: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  }) as Request;

describe('RequestInfoMiddleware', () => {
  it('persists only IP-shaped req.ip into origin, falling back to the socket address', () => {
    const clsValues = new Map<string, unknown>();
    const cls = {
      get: vi.fn(),
      set: vi.fn((key: string, value: unknown) => {
        clsValues.set(key, value);
      }),
    } as unknown as ClsService<IClsStore>;
    const res = {
      once: vi.fn(),
      writableEnded: false,
      destroyed: false,
    } as unknown as Response;
    const middleware = new RequestInfoMiddleware(cls);
    const originIp = () => (clsValues.get('origin') as IClsStore['origin']).ip;

    middleware.use(createRequest({ ip: '203.0.113.7' }), res, vi.fn());
    expect(originIp()).toBe('203.0.113.7');

    middleware.use(createRequest({ ip: '::ffff:203.0.113.7' }), res, vi.fn());
    expect(originIp()).toBe('::ffff:203.0.113.7');

    middleware.use(createRequest({ ip: '2001:db8::1' }), res, vi.fn());
    expect(originIp()).toBe('2001:db8::1');

    // Proxy-appended client ports (e.g. ALB client-port preservation) are trimmed.
    middleware.use(createRequest({ ip: '203.0.113.7:8080' }), res, vi.fn());
    expect(originIp()).toBe('203.0.113.7');

    middleware.use(createRequest({ ip: '[2001:db8::1]:8080' }), res, vi.fn());
    expect(originIp()).toBe('2001:db8::1');

    // Forged X-Forwarded-For from a trusted (private) peer: not IP-shaped -> socket wins.
    middleware.use(
      createRequest({
        ip: '<img src=x onerror=alert(1)>',
        socket: { remoteAddress: '10.0.0.5' } as Request['socket'],
      }),
      res,
      vi.fn()
    );
    expect(originIp()).toBe('10.0.0.5');
  });

  it('records the called endpoint without its query string', () => {
    const clsValues = new Map<string, unknown>();
    const cls = {
      get: vi.fn(),
      set: vi.fn((key: string, value: unknown) => {
        clsValues.set(key, value);
      }),
    } as unknown as ClsService<IClsStore>;
    const res = { once: vi.fn(), writableEnded: false, destroyed: false } as unknown as Response;
    const middleware = new RequestInfoMiddleware(cls);

    middleware.use(
      createRequest({
        method: 'POST',
        originalUrl: '/api/table/tbl1/selection/delete-by-id?search=secret',
        // Express rewrites req.path to '/' for wildcard-mounted middleware — originalUrl wins.
        path: '/',
      }),
      res,
      vi.fn()
    );

    const origin = clsValues.get('origin') as IClsStore['origin'];
    expect(origin.method).toBe('POST');
    expect(origin.path).toBe('/api/table/tbl1/selection/delete-by-id');
  });

  it('captures the affiliate cookie into CLS, ignoring unrelated cookies', () => {
    const clsValues = new Map<string, unknown>();
    const cls = {
      get: vi.fn(),
      set: vi.fn((key: string, value: unknown) => {
        clsValues.set(key, value);
      }),
    } as unknown as ClsService<IClsStore>;
    const res = { once: vi.fn(), writableEnded: false, destroyed: false } as unknown as Response;
    const middleware = new RequestInfoMiddleware(cls);

    middleware.use(
      createRequest({ headers: { cookie: 'session=abc; teable_affiliate_via=ariex; other=1' } }),
      res,
      vi.fn()
    );
    expect(clsValues.get('affiliateVia')).toBe('ariex');

    // No affiliate cookie -> the CLS key is never set.
    clsValues.clear();
    middleware.use(createRequest({ headers: { cookie: 'session=abc' } }), res, vi.fn());
    expect(clsValues.has('affiliateVia')).toBe(false);

    // Values are URL-decoded; a cookie whose name merely ends with the target
    // name must not match.
    clsValues.clear();
    middleware.use(
      createRequest({
        headers: { cookie: 'x_teable_affiliate_via=nope; teable_affiliate_via=k%20ol' },
      }),
      res,
      vi.fn()
    );
    expect(clsValues.get('affiliateVia')).toBe('k ol');
  });

  it('runs v2 background tasks only after the HTTP response finishes', async () => {
    vi.useFakeTimers();
    try {
      const clsValues = new Map<string, unknown>();
      const cls = {
        get: vi.fn(() => undefined),
        runWith: vi.fn((_store: IClsStore, callback: () => void) => callback()),
        set: vi.fn((key: string, value: unknown) => {
          clsValues.set(key, value);
        }),
      } as unknown as ClsService<IClsStore>;
      const listeners = new Map<string, () => void>();
      const res = {
        once: vi.fn((event: string, listener: () => void) => {
          listeners.set(event, listener);
          return res;
        }),
        writableEnded: false,
        destroyed: false,
      } as unknown as Response;
      const next = vi.fn();
      const middleware = new RequestInfoMiddleware(cls);

      middleware.use(createRequest(), res, next);
      const schedule = clsValues.get('scheduleV2BackgroundTask') as NonNullable<
        IClsStore['scheduleV2BackgroundTask']
      >;
      const task = vi.fn();

      schedule(task);
      expect(next).toHaveBeenCalledWith();
      expect(task).not.toHaveBeenCalled();

      listeners.get('finish')?.();
      expect(task).not.toHaveBeenCalled();
      await vi.runAllTimersAsync();

      expect(task).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs v2 background tasks in FIFO order with bounded concurrency', async () => {
    vi.useFakeTimers();
    try {
      const clsValues = new Map<string, unknown>();
      const cls = {
        get: vi.fn(() => undefined),
        runWith: vi.fn((_store: IClsStore, callback: () => void) => callback()),
        set: vi.fn((key: string, value: unknown) => {
          clsValues.set(key, value);
        }),
      } as unknown as ClsService<IClsStore>;
      const listeners = new Map<string, () => void>();
      const res = {
        once: vi.fn((event: string, listener: () => void) => {
          listeners.set(event, listener);
          return res;
        }),
        writableEnded: false,
        destroyed: false,
      } as unknown as Response;
      const middleware = new RequestInfoMiddleware(cls);
      const releases: Array<() => void> = [];
      const started: number[] = [];
      let activeTasks = 0;
      let peakActiveTasks = 0;

      middleware.use(createRequest(), res, vi.fn());
      const schedule = clsValues.get('scheduleV2BackgroundTask') as NonNullable<
        IClsStore['scheduleV2BackgroundTask']
      >;
      for (let index = 0; index < 10; index += 1) {
        schedule(
          () =>
            new Promise<void>((resolve) => {
              started.push(index);
              activeTasks += 1;
              peakActiveTasks = Math.max(peakActiveTasks, activeTasks);
              releases.push(() => {
                activeTasks -= 1;
                resolve();
              });
            })
        );
      }

      listeners.get('finish')?.();
      listeners.get('close')?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(started).toEqual([0, 1, 2, 3]);
      expect(peakActiveTasks).toBe(4);

      for (let completed = 0; completed < 10; completed += 1) {
        releases.shift()?.();
        await vi.advanceTimersByTimeAsync(0);
      }

      expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(activeTasks).toBe(0);
      expect(peakActiveTasks).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('continues draining when a v2 background task rejects', async () => {
    vi.useFakeTimers();
    const loggerError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const clsValues = new Map<string, unknown>();
      const cls = {
        get: vi.fn(() => undefined),
        runWith: vi.fn((_store: IClsStore, callback: () => void) => callback()),
        set: vi.fn((key: string, value: unknown) => {
          clsValues.set(key, value);
        }),
      } as unknown as ClsService<IClsStore>;
      const listeners = new Map<string, () => void>();
      const res = {
        once: vi.fn((event: string, listener: () => void) => {
          listeners.set(event, listener);
          return res;
        }),
        writableEnded: false,
        destroyed: false,
      } as unknown as Response;
      const middleware = new RequestInfoMiddleware(cls);
      const completed = vi.fn();

      middleware.use(createRequest(), res, vi.fn());
      const schedule = clsValues.get('scheduleV2BackgroundTask') as NonNullable<
        IClsStore['scheduleV2BackgroundTask']
      >;
      schedule(() => Promise.reject(new Error('expected background failure')));
      schedule(completed);

      listeners.get('finish')?.();
      await vi.runAllTimersAsync();

      expect(completed).toHaveBeenCalledTimes(1);
      expect(loggerError).toHaveBeenCalledOnce();
    } finally {
      loggerError.mockRestore();
      vi.useRealTimers();
    }
  });

  it('runs v2 background tasks with the CLS store captured when scheduled', async () => {
    vi.useFakeTimers();
    try {
      const clsValues = new Map<string, unknown>();
      const scheduledStore = {
        audit: {
          rootAction: 'table.duplicate',
          operationId: 'op_1',
        },
      } as IClsStore;
      const cls = {
        get: vi.fn(() => scheduledStore),
        runWith: vi.fn((_store: IClsStore, callback: () => void) => callback()),
        set: vi.fn((key: string, value: unknown) => {
          clsValues.set(key, value);
        }),
      } as unknown as ClsService<IClsStore>;
      const listeners = new Map<string, () => void>();
      const res = {
        once: vi.fn((event: string, listener: () => void) => {
          listeners.set(event, listener);
          return res;
        }),
        writableEnded: false,
        destroyed: false,
      } as unknown as Response;
      const middleware = new RequestInfoMiddleware(cls);

      middleware.use(createRequest(), res, vi.fn());
      const schedule = clsValues.get('scheduleV2BackgroundTask') as NonNullable<
        IClsStore['scheduleV2BackgroundTask']
      >;
      const task = vi.fn();

      schedule(task);
      listeners.get('finish')?.();
      await vi.runAllTimersAsync();

      expect(cls.runWith).toHaveBeenCalledWith(scheduledStore, expect.any(Function));
      expect(task).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
