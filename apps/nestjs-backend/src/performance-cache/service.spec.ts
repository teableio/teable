import type { ConfigService } from '@nestjs/config';
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
