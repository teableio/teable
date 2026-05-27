import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataDbRuntimeCacheService } from './data-db-runtime-cache.service';

describe('DataDbRuntimeCacheService', () => {
  afterEach(() => {
    delete process.env.BYODB_RUNTIME_CACHE_MAX;
  });

  it('reuses entries by namespace and key', async () => {
    const cache = new DataDbRuntimeCacheService();
    const create = vi.fn().mockResolvedValue({ id: 'client' });
    const destroy = vi.fn();

    await expect(cache.getOrCreate('ns', 'key', create, destroy)).resolves.toEqual({
      id: 'client',
    });
    await expect(cache.getOrCreate('ns', 'key', create, destroy)).resolves.toEqual({
      id: 'client',
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
    await cache.onModuleDestroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('evicts the least recently used entry and destroys it', async () => {
    process.env.BYODB_RUNTIME_CACHE_MAX = '2';
    const cache = new DataDbRuntimeCacheService();
    const destroy = vi.fn();

    await cache.getOrCreate('ns', 'a', () => Promise.resolve('a'), destroy);
    await cache.getOrCreate('ns', 'b', () => Promise.resolve('b'), destroy);
    await cache.getOrCreate('ns', 'a', () => Promise.resolve('new-a'), destroy);
    await cache.getOrCreate('ns', 'c', () => Promise.resolve('c'), destroy);

    expect(destroy).toHaveBeenCalledWith('b');
    expect(cache.size).toBe(2);
    await cache.onModuleDestroy();
  });

  it('can actively invalidate all runtimes for a connection key', async () => {
    const cache = new DataDbRuntimeCacheService();
    const destroy = vi.fn();

    await cache.getOrCreate('prisma', 'dcnxxx', () => Promise.resolve('prisma'), destroy);
    await cache.getOrCreate('knex', 'dcnxxx', () => Promise.resolve('knex'), destroy);
    await cache.getOrCreate('v2', 'dcnxxx', () => Promise.resolve('container'), destroy);

    await cache.deleteByKey('dcnxxx');

    expect(destroy).toHaveBeenCalledTimes(3);
    expect(cache.size).toBe(0);
  });
});
