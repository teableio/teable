import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { ClsService } from 'nestjs-cls';
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
  it('runs v2 background tasks only after the HTTP response finishes', () => {
    const globalWithTimeout = globalThis as {
      setTimeout: typeof setTimeout;
    };
    const originalSetTimeout = globalWithTimeout.setTimeout;
    const timers: Array<() => void> = [];
    globalWithTimeout.setTimeout = ((callback: () => void) => {
      timers.push(callback);
      return { unref: vi.fn() };
    }) as unknown as typeof setTimeout;

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
      expect(timers).toHaveLength(0);

      listeners.get('finish')?.();

      expect(task).not.toHaveBeenCalled();
      expect(timers).toHaveLength(1);

      timers.shift()?.();

      expect(task).toHaveBeenCalledTimes(1);
    } finally {
      globalWithTimeout.setTimeout = originalSetTimeout;
    }
  });

  it('runs v2 background tasks with the CLS store captured when scheduled', () => {
    const globalWithTimeout = globalThis as {
      setTimeout: typeof setTimeout;
    };
    const originalSetTimeout = globalWithTimeout.setTimeout;
    const timers: Array<() => void> = [];
    globalWithTimeout.setTimeout = ((callback: () => void) => {
      timers.push(callback);
      return { unref: vi.fn() };
    }) as unknown as typeof setTimeout;

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
      timers.shift()?.();

      expect(cls.runWith).toHaveBeenCalledWith(scheduledStore, expect.any(Function));
      expect(task).toHaveBeenCalledTimes(1);
    } finally {
      globalWithTimeout.setTimeout = originalSetTimeout;
    }
  });
});
