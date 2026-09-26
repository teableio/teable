import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ExecutionError } from 'redlock';
import { PerformanceCacheService } from './service';

function createService() {
  const values = new Map<string, unknown>();
  const redisData = new Map<string, string>();
  const service = new PerformanceCacheService({
    get: () => undefined,
  } as unknown as ConfigService);

  const redis = {
    get: vi.fn(async (key: string) => redisData.get(key) ?? null),
    multi: vi.fn(() => {
      const commands: Array<() => void> = [];
      const chain = {
        incr: (key: string) => {
          commands.push(() => redisData.set(key, String(Number(redisData.get(key) ?? '0') + 1)));
          return chain;
        },
        pexpire: () => chain,
        exec: async () => {
          commands.forEach((command) => command());
          return [];
        },
      };
      return chain;
    }),
  };

  const keyv = {
    get: vi.fn(async (key: string) => values.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
      return true;
    }),
    delete: vi.fn(async (key: string) => {
      values.delete(key);
      return true;
    }),
  };

  Object.assign(service, { enabled: true, redis, keyv });

  return { service, keyv, redis };
}

describe('PerformanceCacheService generation', () => {
  it('does not keep a value loaded before del()', async () => {
    const { service, keyv } = createService();
    const key = 'instance:setting:v3' as const;

    let started = false;
    let allowFinish: () => void = () => undefined;
    const wait = new Promise<void>((resolve) => {
      allowFinish = resolve;
    });

    const wrapPromise = service.wrap(
      key,
      async () => {
        started = true;
        await wait;
        return { stale: true };
      },
      { ttl: 60, preventConcurrent: false }
    );

    await vi.waitFor(() => {
      expect(started).toBe(true);
    });

    await service.del(key);
    allowFinish();
    await wrapPromise;

    expect(await service.get(key)).toBeNull();
    expect(keyv.delete).toHaveBeenCalledWith(key);

    const fresh = await service.wrap(key, async () => ({ stale: false }), {
      ttl: 60,
      preventConcurrent: false,
    });
    expect(fresh).toEqual({ stale: false });
    expect((await service.get(key))?.data).toEqual({ stale: false });
  });

  it('serves a value written after invalidation', async () => {
    const { service } = createService();
    const key = 'user:usr1' as const;

    await service.set(key, { id: 'old' } as never, { ttl: 30 });
    await service.del(key);
    await service.set(key, { id: 'new' } as never, { ttl: 30 });

    expect((await service.get(key))?.data).toEqual({ id: 'new' });
  });
});

describe('PerformanceCacheService lock contention', () => {
  it('does not start duplicate loaders when a slow producer outlives lock retries', async () => {
    const { service } = createService();
    let unlock: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    let acquired = false;
    Object.assign(service, {
      redlock: {
        using: vi.fn(async (_keys, _duration, work) => {
          if (acquired) throw new ExecutionError('Lock retries exhausted', []);
          acquired = true;
          return work({ aborted: false });
        }),
      },
    });
    const loader = vi.fn(async () => {
      await pending;
      return { ready: true };
    });
    const producer = service.wrap('instance:setting:v3', loader, { ttl: 60 });
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    const waiters = await Promise.allSettled(
      Array.from({ length: 8 }, () => service.wrap('instance:setting:v3', loader, { ttl: 60 }))
    );
    expect(loader).toHaveBeenCalledTimes(1);
    for (const result of waiters) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected')
        expect(result.reason).toBeInstanceOf(ServiceUnavailableException);
    }
    unlock();
    await expect(producer).resolves.toEqual({ ready: true });
    await expect(service.wrap('instance:setting:v3', loader, { ttl: 60 })).resolves.toEqual({
      ready: true,
    });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('preserves a loader error even if it has the same type as a lock error', async () => {
    const { service } = createService();
    Object.assign(service, {
      redlock: { using: vi.fn(async (_keys, _duration, work) => work({ aborted: false })) },
    });
    const failure = new ExecutionError('Loader failed', []);
    const loader = vi.fn(async () => {
      throw failure;
    });
    await expect(service.wrap('instance:setting:v3', loader, { ttl: 60 })).rejects.toBe(failure);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('uses a cache value populated as lock acquisition fails', async () => {
    const { service } = createService();
    Object.assign(service, {
      redlock: {
        using: vi.fn(async () => {
          await service.set('instance:setting:v3', { ready: true } as never, { ttl: 60 });
          throw new ExecutionError('Lock retries exhausted', []);
        }),
      },
    });
    const loader = vi.fn();
    await expect(service.wrap('instance:setting:v3', loader, { ttl: 60 })).resolves.toEqual({
      ready: true,
    });
    expect(loader).not.toHaveBeenCalled();
  });
});
