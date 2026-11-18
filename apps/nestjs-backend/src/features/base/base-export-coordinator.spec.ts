import { AsyncLocalStorage } from 'node:async_hooks';
import { Logger } from '@nestjs/common';
import type { ExportBaseProgressCallback, IExportBaseVo } from '@teable/openapi';
import Keyv from 'keyv';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheService } from '../../cache/cache.service';
import { BaseExportCoordinator } from './base-export-coordinator';

// Node 22 provides this API; this package's ES2022 TypeScript library predates it.
const promiseWithResolvers = Promise as unknown as {
  withResolvers<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
};

const options = { baseId: 'base-1', includeData: true, userId: 'user-1' };
const exported: IExportBaseVo = {
  previewUrl: 'https://example.test/export.tea',
  baseName: 'Example',
  fileName: 'export.tea',
};

const createCache = () => {
  const leases = new Map<string, string>();
  const cache = {
    getKeyv: () => ({ opts: { store: { redis: {} } } }),
    setnx: vi.fn(async (key: string, token: string, _ttl: number) => {
      if (leases.has(key)) return false;
      leases.set(key, token);
      return true;
    }),
    renewLock: vi.fn(async (key: string, token: string, _ttl: number) => leases.get(key) === token),
    releaseLock: vi.fn(async (key: string, token: string) => {
      if (leases.get(key) !== token) return false;
      return leases.delete(key);
    }),
  };
  return {
    cache,
    leases,
    coordinator: new BaseExportCoordinator(cache as unknown as CacheService),
  };
};

const createExpiringCache = () => {
  const leases = new Map<string, { token: string; expiresAt: number }>();
  const currentLease = (key: string) => {
    const lease = leases.get(key);
    if (lease && lease.expiresAt > Date.now()) return lease;
    leases.delete(key);
  };
  const cache = {
    getKeyv: () => ({ opts: { store: { redis: {} } } }),
    setnx: vi.fn(async (key: string, token: string, ttl: number) => {
      if (currentLease(key)) return false;
      leases.set(key, { token, expiresAt: Date.now() + ttl * 1000 });
      return true;
    }),
    renewLock: vi.fn(async (key: string, token: string, ttl: number) => {
      if (currentLease(key)?.token !== token) return false;
      leases.set(key, { token, expiresAt: Date.now() + ttl * 1000 });
      return true;
    }),
    releaseLock: vi.fn(async (key: string, token: string) => {
      if (currentLease(key)?.token !== token) return false;
      return leases.delete(key);
    }),
  };
  return {
    cache,
    leases,
    coordinator: new BaseExportCoordinator(cache as unknown as CacheService),
  };
};

const createWork = () => {
  const started = promiseWithResolvers.withResolvers<{
    signal: AbortSignal;
    onProgress: ExportBaseProgressCallback;
    commitTerminalOutcome: () => boolean;
  }>();
  const finish = promiseWithResolvers.withResolvers<IExportBaseVo | undefined>();
  const work = vi.fn(
    async (
      signal: AbortSignal,
      onProgress: ExportBaseProgressCallback,
      commitTerminalOutcome: () => boolean
    ) => {
      started.resolve({ signal, onProgress, commitTerminalOutcome });
      return finish.promise;
    }
  );
  return { work, started: started.promise, finish };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('BaseExportCoordinator', () => {
  it('supports a genuine Keyv memory store with local sharing and bounded admission', async () => {
    const cache = new CacheService(new Keyv({ store: new Map() }));
    const coordinator = new BaseExportCoordinator(cache);
    const { work, started, finish } = createWork();
    const first = coordinator.run(options, work);
    const active = await started;
    active.onProgress('uploading');
    const onProgress = vi.fn();
    const second = coordinator.run({ ...options, onProgress }, work);
    expect(onProgress).toHaveBeenCalledWith('uploading');
    const contender = vi.fn(async () => exported);
    await expect(
      coordinator.run({ ...options, userId: 'user-2' }, contender)
    ).rejects.toMatchObject({ status: 429 });
    expect(contender).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(active.signal.aborted).toBe(false);
    finish.resolve(exported);
    await expect(first).resolves.toEqual(exported);
    await expect(second).resolves.toEqual(exported);
    expect(work).toHaveBeenCalledTimes(1);
    await expect(coordinator.run(options, contender)).resolves.toEqual(exported);
  });

  it('retains local memory-mode capacity until cancelled work has cleaned up', async () => {
    const coordinator = new BaseExportCoordinator(new CacheService(new Keyv()));
    const { work, started, finish } = createWork();
    const controller = new AbortController();
    const result = coordinator.run({ ...options, signal: controller.signal }, work);
    const active = await started;
    const aborted = expect(result).rejects.toThrow('memory caller left');
    controller.abort(new Error('memory caller left'));
    await aborted;
    expect(active.signal.aborted).toBe(true);
    await expect(coordinator.run(options, async () => exported)).rejects.toMatchObject({
      status: 429,
    });
    finish.reject(new Error('cancelled work cleanup'));
    await vi.advanceTimersByTimeAsync(0);
    await expect(coordinator.run(options, async () => exported)).resolves.toEqual(exported);
    const failure = new Error('memory export failed');
    await expect(
      coordinator.run(options, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
    await expect(coordinator.run(options, async () => exported)).resolves.toEqual(exported);
  });

  it('shares one initiating-user task, progress and result while retaining the original context', async () => {
    const { coordinator } = createCache();
    const context = new AsyncLocalStorage<string>();
    const { work, started, finish } = createWork();
    const firstProgress = vi.fn();
    const secondProgress = vi.fn();
    const ignoredWork = vi.fn(async () => undefined);
    let workContext: string | undefined;
    const first = context.run('initiator', () =>
      coordinator.run({ ...options, onProgress: firstProgress }, (signal, onProgress, commit) => {
        workContext = context.getStore();
        return work(signal, onProgress, commit);
      })
    );
    const second = context.run('joining-request', () =>
      coordinator.run({ ...options, onProgress: secondProgress }, ignoredWork)
    );
    const active = await started;
    active.onProgress('exporting', 'one table');
    finish.resolve(exported);

    await expect(first).resolves.toEqual(exported);
    await expect(second).resolves.toEqual(exported);
    expect(firstProgress).toHaveBeenCalledWith('exporting', 'one table');
    expect(secondProgress).toHaveBeenCalledWith('exporting', 'one table');
    expect(work).toHaveBeenCalledTimes(1);
    expect(ignoredWork).not.toHaveBeenCalled();
    expect(workContext).toBe('initiator');
  });

  it.each([{ baseId: 'base-2' }, { includeData: false }, { userId: 'user-2' }])(
    'rejects a distinct request %j while lease acquisition is pending',
    async (different) => {
      const { coordinator, cache } = createCache();
      const lease = promiseWithResolvers.withResolvers<boolean>();
      cache.setnx.mockReturnValueOnce(lease.promise);
      const { work, started, finish } = createWork();
      const first = coordinator.run(options, work);
      const contender = vi.fn(async () => exported);
      const onProgress = vi.fn();
      await expect(
        coordinator.run({ ...options, ...different, onProgress }, contender)
      ).rejects.toMatchObject({ status: 429 });
      expect(contender).not.toHaveBeenCalled();
      expect(onProgress).not.toHaveBeenCalled();
      lease.resolve(true);
      await started;
      finish.resolve(exported);
      await expect(first).resolves.toEqual(exported);
    }
  );

  it('cancels only one subscriber and removes its progress callback', async () => {
    const { coordinator } = createCache();
    const { work, started, finish } = createWork();
    const cancellation = new AbortController();
    const onProgress = vi.fn();
    const first = coordinator.run({ ...options, signal: cancellation.signal, onProgress }, work);
    const remainingProgress = vi.fn();
    const second = coordinator.run({ ...options, onProgress: remainingProgress }, work);
    const active = await started;
    const aborted = expect(first).rejects.toThrow('caller left');
    cancellation.abort(new Error('caller left'));
    await aborted;
    expect(active.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(2);
    active.onProgress('exporting');
    expect(onProgress).not.toHaveBeenCalled();
    expect(remainingProgress).toHaveBeenCalledWith('exporting');
    finish.resolve(exported);
    await expect(second).resolves.toEqual(exported);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('holds capacity after all callers leave until work and lease cleanup settle', async () => {
    const { coordinator, cache } = createCache();
    const { work, started, finish } = createWork();
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = coordinator.run({ ...options, signal: firstController.signal }, work);
    const second = coordinator.run({ ...options, signal: secondController.signal }, work);
    const active = await started;
    const firstAborted = expect(first).rejects.toThrow('first left');
    const secondAborted = expect(second).rejects.toThrow('second left');
    firstController.abort(new Error('first left'));
    secondController.abort(new Error('second left'));
    await Promise.all([firstAborted, secondAborted]);
    expect(active.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const contender = vi.fn(async () => exported);
    await expect(coordinator.run(options, contender)).rejects.toMatchObject({ status: 429 });
    await expect(
      coordinator.run({ ...options, baseId: 'base-2' }, contender)
    ).rejects.toMatchObject({ status: 429 });
    expect(contender).not.toHaveBeenCalled();

    const release = promiseWithResolvers.withResolvers<boolean>();
    const releaseLock = cache.releaseLock.getMockImplementation()!;
    cache.releaseLock.mockImplementationOnce(async (key, token) => {
      await release.promise;
      return releaseLock(key, token);
    });
    finish.resolve(exported);
    await vi.advanceTimersByTimeAsync(0);
    await expect(coordinator.run(options, contender)).rejects.toMatchObject({ status: 429 });
    release.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    await expect(coordinator.run(options, contender)).resolves.toEqual(exported);
  });

  it('starts nothing for an already aborted subscriber', async () => {
    const { coordinator, cache } = createCache();
    const controller = new AbortController();
    controller.abort(new Error('already gone'));
    const work = vi.fn(async () => exported);
    await expect(coordinator.run({ ...options, signal: controller.signal }, work)).rejects.toThrow(
      'already gone'
    );
    expect(work).not.toHaveBeenCalled();
    expect(cache.setnx).not.toHaveBeenCalled();
    await expect(coordinator.run(options, work)).resolves.toEqual(exported);
  });

  it('reports cancellation after pending acquisition cleanup without starting export work', async () => {
    const { coordinator, cache } = createCache();
    const lease = promiseWithResolvers.withResolvers<boolean>();
    const release = promiseWithResolvers.withResolvers<boolean>();
    const notification = promiseWithResolvers.withResolvers<void>();
    cache.setnx.mockReturnValueOnce(lease.promise);
    cache.releaseLock.mockReturnValueOnce(release.promise);
    const onCancelled = vi.fn(async () => notification.promise);
    const controller = new AbortController();
    const work = vi.fn(async () => exported);
    const result = coordinator.run({ ...options, signal: controller.signal, onCancelled }, work);
    const aborted = expect(result).rejects.toThrow('gone during acquisition');
    controller.abort(new DOMException('gone during acquisition', 'AbortError'));
    await aborted;
    await expect(coordinator.run(options, work)).rejects.toMatchObject({ status: 429 });
    lease.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(work).not.toHaveBeenCalled();
    expect(onCancelled).not.toHaveBeenCalled();
    await expect(coordinator.run(options, work)).rejects.toMatchObject({ status: 429 });
    release.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(onCancelled).toHaveBeenCalledTimes(1);
    await expect(coordinator.run(options, work)).rejects.toMatchObject({ status: 429 });
    notification.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await expect(coordinator.run(options, work)).resolves.toEqual(exported);
    expect(onCancelled).toHaveBeenCalledTimes(1);
  });

  it('releases the slot after ordinary task failure and preserves that failure if release throws', async () => {
    const { coordinator, cache } = createCache();
    const failure = new Error('upload failed');
    cache.releaseLock.mockRejectedValueOnce(new Error('redis disconnected'));
    await expect(
      coordinator.run(options, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
    await expect(
      coordinator.run({ ...options, baseId: 'base-2' }, async () => exported)
    ).resolves.toEqual(exported);
  });

  it('returns an undefined work result and does not turn a release error into failure', async () => {
    const { coordinator, cache } = createCache();
    cache.releaseLock.mockRejectedValueOnce(new Error('release failed'));
    await expect(coordinator.run(options, async () => undefined)).resolves.toBeUndefined();
    await expect(
      coordinator.run({ ...options, baseId: 'base-2' }, async () => exported)
    ).resolves.toEqual(exported);
  });

  it.each([
    { acquisition: 'busy', status: 429 },
    { acquisition: 'unavailable', status: 503 },
  ])(
    'fails closed on $acquisition acquisition and frees capacity',
    async ({ acquisition, status }) => {
      const { coordinator, cache } = createCache();
      if (acquisition === 'busy') cache.setnx.mockResolvedValueOnce(false);
      else cache.setnx.mockRejectedValueOnce(new Error('redis unavailable'));
      const work = vi.fn(async () => exported);
      await expect(coordinator.run(options, work)).rejects.toMatchObject({ status });
      expect(work).not.toHaveBeenCalled();
      await expect(coordinator.run(options, work)).resolves.toEqual(exported);
    }
  );

  it('blocks the same base across coordinator instances and releases it after completion', async () => {
    const { coordinator, cache } = createCache();
    const other = new BaseExportCoordinator(cache as unknown as CacheService);
    const { work, started, finish } = createWork();
    const first = coordinator.run(options, work);
    await started;
    const contender = vi.fn(async () => exported);
    await expect(
      other.run({ ...options, userId: 'user-2', includeData: false }, contender)
    ).rejects.toMatchObject({ status: 429 });
    expect(contender).not.toHaveBeenCalled();
    finish.resolve(exported);
    await first;
    await expect(other.run(options, contender)).resolves.toEqual(exported);
  });

  it.each(['lost', 'error'])(
    'aborts and rejects subscribers when renewal is %s',
    async (failure) => {
      const { coordinator, cache } = createCache();
      if (failure === 'lost') cache.renewLock.mockResolvedValueOnce(false);
      else cache.renewLock.mockRejectedValueOnce(new Error('redis down'));
      const { work, started, finish } = createWork();
      const first = coordinator.run(options, work);
      const second = coordinator.run(options, work);
      const active = await started;
      const failed = [
        expect(first).rejects.toMatchObject({ status: 503 }),
        expect(second).rejects.toMatchObject({ status: 503 }),
      ];
      await vi.advanceTimersByTimeAsync(20_000);
      await Promise.all(failed);
      expect(active.signal.aborted).toBe(true);
      const contender = vi.fn(async () => exported);
      await expect(coordinator.run(options, contender)).rejects.toMatchObject({ status: 429 });
      finish.resolve(exported);
      await vi.advanceTimersByTimeAsync(0);
      await expect(coordinator.run(options, contender)).resolves.toEqual(exported);
    }
  );

  it('renews without overlapping calls and waits for a late renewal before releasing', async () => {
    const { coordinator, cache } = createCache();
    const renewal = promiseWithResolvers.withResolvers<boolean>();
    cache.renewLock.mockReturnValueOnce(renewal.promise);
    const { work, started, finish } = createWork();
    const first = coordinator.run(options, work);
    const active = await started;
    await vi.advanceTimersByTimeAsync(40_000);
    expect(cache.renewLock).toHaveBeenCalledTimes(1);
    finish.resolve(exported);
    await vi.advanceTimersByTimeAsync(0);
    await expect(coordinator.run(options, async () => exported)).rejects.toMatchObject({
      status: 429,
    });
    renewal.resolve(false);
    await expect(first).resolves.toEqual(exported);
    expect(active.signal.aborted).toBe(false);
    await expect(coordinator.run(options, async () => exported)).resolves.toEqual(exported);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['lost', 'error'])(
    'keeps a committed outcome through disconnect and late %s renewal until owner release',
    async (failure) => {
      const { coordinator, cache } = createCache();
      const renewal = promiseWithResolvers.withResolvers<boolean>();
      const release = promiseWithResolvers.withResolvers<void>();
      cache.renewLock.mockReturnValueOnce(renewal.promise);
      const realRelease = cache.releaseLock.getMockImplementation()!;
      cache.releaseLock.mockImplementationOnce(async (key, token) => {
        await release.promise;
        return realRelease(key, token);
      });
      const { work, started, finish } = createWork();
      const onCancelled = vi.fn(async () => undefined);
      const controller = new AbortController();
      const result = coordinator.run({ ...options, signal: controller.signal, onCancelled }, work);
      const active = await started;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(cache.renewLock).toHaveBeenCalledTimes(1);
      expect(active.commitTerminalOutcome()).toBe(true);
      expect(active.commitTerminalOutcome()).toBe(false);
      expect(vi.getTimerCount()).toBe(1);

      const disconnected = expect(result).rejects.toThrow('left during terminal delivery');
      controller.abort(new DOMException('left during terminal delivery', 'AbortError'));
      await disconnected;
      expect(active.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(active.signal.aborted).toBe(false);
      expect(cache.renewLock).toHaveBeenCalledTimes(1);
      await expect(coordinator.run(options, async () => exported)).rejects.toMatchObject({
        status: 429,
      });

      expect(cache.releaseLock).not.toHaveBeenCalled();
      if (failure === 'lost') renewal.resolve(false);
      else renewal.reject(new Error('late Redis renewal error'));
      await vi.advanceTimersByTimeAsync(0);
      expect(active.signal.aborted).toBe(false);
      expect(cache.releaseLock).not.toHaveBeenCalled();
      finish.resolve(exported);
      await vi.advanceTimersByTimeAsync(0);
      expect(cache.releaseLock).toHaveBeenCalledTimes(1);
      await expect(coordinator.run(options, async () => exported)).rejects.toMatchObject({
        status: 429,
      });
      release.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(onCancelled).not.toHaveBeenCalled();
      await expect(coordinator.run(options, async () => exported)).resolves.toEqual(exported);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('renews healthy ownership after terminal publication until pending work finishes', async () => {
    const { coordinator, cache } = createCache();
    const { work, started, finish } = createWork();
    const result = coordinator.run(options, work);
    const active = await started;
    expect(active.commitTerminalOutcome()).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(cache.renewLock).toHaveBeenCalledTimes(3);
    expect(cache.releaseLock).not.toHaveBeenCalled();
    expect(active.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    await expect(coordinator.run({ ...options, baseId: 'base-2' }, work)).rejects.toMatchObject({
      status: 429,
    });

    finish.resolve(exported);
    await expect(result).resolves.toEqual(exported);
    expect(cache.releaseLock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts at confirmed expiry during a stalled renewal and fences late cleanup from a new owner', async () => {
    const { coordinator, cache, leases } = createExpiringCache();
    const renewal = promiseWithResolvers.withResolvers<void>();
    const renewLock = cache.renewLock.getMockImplementation()!;
    cache.renewLock.mockImplementationOnce(async (key, token, ttl) => {
      await renewal.promise;
      return renewLock(key, token, ttl);
    });
    const { work, started, finish } = createWork();
    const first = coordinator.run(options, work);
    const second = coordinator.run(options, work);
    const active = await started;
    const failed = [
      expect(first).rejects.toMatchObject({ status: 503 }),
      expect(second).rejects.toMatchObject({ status: 503 }),
    ];
    await vi.advanceTimersByTimeAsync(59_999);
    expect(active.signal.aborted).toBe(false);
    expect(cache.renewLock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all(failed);
    expect(active.signal.aborted).toBe(true);
    expect(active.signal.reason).toMatchObject({ status: 503 });
    expect(vi.getTimerCount()).toBe(0);
    await expect(coordinator.run(options, async () => exported)).rejects.toMatchObject({
      status: 429,
    });

    const other = new BaseExportCoordinator(cache as unknown as CacheService);
    const replacement = createWork();
    const replacementResult = other.run(options, replacement.work);
    const replacementActive = await replacement.started;
    const replacementLease = leases.get('lock:base-export:base-1');
    finish.resolve(exported);
    await vi.advanceTimersByTimeAsync(0);
    expect(cache.releaseLock).not.toHaveBeenCalled();
    await expect(coordinator.run(options, async () => exported)).rejects.toMatchObject({
      status: 429,
    });
    renewal.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(cache.releaseLock).toHaveBeenCalledTimes(1);
    expect(leases.get('lock:base-export:base-1')).toBe(replacementLease);
    expect(replacementActive.signal.aborted).toBe(false);
    await expect(coordinator.run(options, async () => exported)).rejects.toMatchObject({
      status: 429,
    });
    replacement.finish.resolve(exported);
    await expect(replacementResult).resolves.toEqual(exported);
    expect(vi.getTimerCount()).toBe(0);
    await expect(coordinator.run(options, async () => exported)).resolves.toEqual(exported);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('moves the confirmed deadline from renewal send time without adding response latency', async () => {
    const { coordinator, cache } = createExpiringCache();
    const response = promiseWithResolvers.withResolvers<void>();
    const stalled = promiseWithResolvers.withResolvers<boolean>();
    const renewLock = cache.renewLock.getMockImplementation()!;
    cache.renewLock.mockImplementationOnce(async (key, token, ttl) => {
      const renewed = await renewLock(key, token, ttl);
      await response.promise;
      return renewed;
    });
    cache.renewLock.mockReturnValueOnce(stalled.promise);
    const { work, started, finish } = createWork();
    const result = coordinator.run(options, work);
    const active = await started;
    const failed = expect(result).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(35_000);
    response.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(44_999);
    expect(active.signal.aborted).toBe(false);
    expect(cache.renewLock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await failed;
    expect(active.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    finish.resolve(exported);
    stalled.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    await expect(coordinator.run(options, async () => exported)).resolves.toEqual(exported);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('counts acquisition response latency against the first confirmed lease deadline', async () => {
    const { coordinator, cache } = createExpiringCache();
    const response = promiseWithResolvers.withResolvers<void>();
    const setnx = cache.setnx.getMockImplementation()!;
    cache.setnx.mockImplementationOnce(async (key, token, ttl) => {
      const acquired = await setnx(key, token, ttl);
      await response.promise;
      return acquired;
    });
    const renewal = promiseWithResolvers.withResolvers<boolean>();
    cache.renewLock.mockReturnValueOnce(renewal.promise);
    const { work, started, finish } = createWork();
    const result = coordinator.run(options, work);
    const failed = expect(result).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(10_000);
    response.resolve();
    const active = await started;
    await vi.advanceTimersByTimeAsync(49_999);
    expect(active.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await failed;
    expect(active.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    finish.resolve(exported);
    renewal.resolve(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never releases a replacement owner lease', async () => {
    const { coordinator, cache, leases } = createCache();
    const { work, started, finish } = createWork();
    const first = coordinator.run(options, work);
    await started;
    leases.set('lock:base-export:base-1', 'replacement-owner');
    finish.resolve(exported);
    await first;
    const other = new BaseExportCoordinator(cache as unknown as CacheService);
    await expect(other.run(options, async () => exported)).rejects.toMatchObject({ status: 429 });
  });

  it('rejects a throwing progress subscriber while another subscriber completes', async () => {
    const { coordinator } = createCache();
    const { work, started, finish } = createWork();
    const failure = new Error('SSE writer failed');
    const first = coordinator.run(
      {
        ...options,
        onProgress: () => {
          throw failure;
        },
      },
      work
    );
    const secondProgress = vi.fn();
    const second = coordinator.run({ ...options, onProgress: secondProgress }, work);
    const failed = expect(first).rejects.toBe(failure);
    const active = await started;
    active.onProgress('exporting');
    await failed;
    expect(active.signal.aborted).toBe(false);
    expect(secondProgress).toHaveBeenCalledWith('exporting');
    finish.resolve(exported);
    await expect(second).resolves.toEqual(exported);
  });

  it('replays the latest progress to a late subscriber and isolates replay errors', async () => {
    const { coordinator } = createCache();
    const { work, started, finish } = createWork();
    const first = coordinator.run(options, work);
    const active = await started;
    active.onProgress('preparing');
    active.onProgress('uploading', 'archive ready');
    const onProgress = vi.fn();
    const second = coordinator.run({ ...options, onProgress }, work);
    expect(onProgress).toHaveBeenCalledExactlyOnceWith('uploading', 'archive ready');
    const failure = new Error('late SSE writer failed');
    const rejected = coordinator.run(
      {
        ...options,
        onProgress: () => {
          throw failure;
        },
      },
      work
    );
    await expect(rejected).rejects.toBe(failure);
    expect(active.signal.aborted).toBe(false);
    finish.resolve(exported);
    await expect(first).resolves.toEqual(exported);
    await expect(second).resolves.toEqual(exported);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('aborts work when the only progress subscriber throws', async () => {
    const { coordinator } = createCache();
    const { work, started, finish } = createWork();
    const failure = new Error('progress consumer failed');
    const result = coordinator.run(
      {
        ...options,
        onProgress: () => {
          throw failure;
        },
      },
      work
    );
    const failed = expect(result).rejects.toBe(failure);
    const active = await started;
    active.onProgress('exporting');
    await failed;
    expect(active.signal.aborted).toBe(true);
    await expect(coordinator.run(options, async () => exported)).rejects.toMatchObject({
      status: 429,
    });
    finish.reject(new Error('cleanup failed after cancellation'));
    await vi.advanceTimersByTimeAsync(0);
    await expect(coordinator.run(options, async () => exported)).resolves.toEqual(exported);
  });
});
