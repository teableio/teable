/* eslint-disable @typescript-eslint/no-explicit-any */
import type Keyv from 'keyv';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheService } from './cache.service';

describe('CacheService.getMany', () => {
  let keyv: { get: ReturnType<typeof vi.fn> };
  let service: CacheService;

  beforeEach(() => {
    keyv = { get: vi.fn().mockResolvedValue([]) };
    service = new CacheService(keyv as unknown as Keyv<any>);
  });

  it('short-circuits an empty key list without hitting the store', async () => {
    expect(await service.getMany([])).toEqual([]);
    expect(keyv.get).not.toHaveBeenCalled();
  });

  it('forwards a non-empty key list to the store', async () => {
    keyv.get.mockResolvedValue(['a-value', undefined]);
    expect(await service.getMany(['a', 'b'] as any)).toEqual(['a-value', undefined]);
    expect(keyv.get).toHaveBeenCalledWith(['a', 'b']);
  });
});

/**
 * The raw Redis commands (setnx, incr) must land on the same physical key the
 * keyv path reads — the key name comes from the store's own `_getKeyName`,
 * and setnx writes the keyv `{value, expires}` envelope. A hand-built
 * `namespace:key` once diverged from the real layout, making every
 * setnx-written key invisible to get()/del().
 */
describe('CacheService raw-command interop with the keyv layout', () => {
  let redis: {
    set: ReturnType<typeof vi.fn>;
    incr: ReturnType<typeof vi.fn>;
    expire: ReturnType<typeof vi.fn>;
  };
  let service: CacheService;

  const makeService = (storeExtras: Record<string, unknown> = {}) => {
    redis = {
      set: vi.fn().mockResolvedValue('OK'),
      incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
    };
    const keyv = {
      opts: {
        namespace: 'teable_cache',
        serialize: JSON.stringify,
        store: {
          // KeyvRedis(useRedisSets: false) prefixes every key like this.
          // eslint-disable-next-line @typescript-eslint/naming-convention
          _getKeyName: (key: string) => `sets:namespace:teable_cache:${key}`,
          redis,
          ...storeExtras,
        },
      },
    };
    service = new CacheService(keyv as unknown as Keyv<any>);
  };

  beforeEach(() => makeService());

  it('setnx writes the store-derived key with a get()-readable envelope', async () => {
    await service.setnx('lock:x', 'owner-1', 30);

    const [physicalKey, payload, ex, ttl, nx] = redis.set.mock.calls[0];
    expect(physicalKey).toBe('sets:namespace:teable_cache:teable_cache:lock:x');
    expect([ex, ttl, nx]).toEqual(['EX', 30, 'NX']);
    // The envelope is what keyv's get() deserializes: {value, expires}.
    const envelope = JSON.parse(payload);
    expect(envelope.value).toBe('owner-1');
    expect(envelope.expires).toBeGreaterThan(Date.now());
    expect(envelope.expires).toBeLessThanOrEqual(Date.now() + 30_000);
  });

  it('incr counts on the store-derived key and applies the first-hit ttl', async () => {
    await service.incr('oauth:device-rate:ip', 60);

    expect(redis.incr).toHaveBeenCalledWith(
      'sets:namespace:teable_cache:teable_cache:oauth:device-rate:ip'
    );
    expect(redis.expire).toHaveBeenCalledWith(
      'sets:namespace:teable_cache:teable_cache:oauth:device-rate:ip',
      60
    );
  });

  it('expire retargets the same derived key that incr counts on', async () => {
    // The sign-in limiter pairs these two: incr counts attempts, expire cuts
    // the counter short at lockout. Split layouts made expire a silent no-op.
    await service.incr('signin:attempts:a@b.c', 30);
    await service.expire('signin:attempts:a@b.c', 1);

    expect(redis.incr).toHaveBeenCalledWith(
      'sets:namespace:teable_cache:teable_cache:signin:attempts:a@b.c'
    );
    expect(redis.expire).toHaveBeenLastCalledWith(
      'sets:namespace:teable_cache:teable_cache:signin:attempts:a@b.c',
      1
    );
  });

  it('falls back to a plain namespace prefix when the store has no _getKeyName', async () => {
    makeService({ _getKeyName: undefined });

    await service.setnx('lock:x', 'owner-1', 30);

    expect(redis.set.mock.calls[0][0]).toBe('teable_cache:lock:x');
  });
});
