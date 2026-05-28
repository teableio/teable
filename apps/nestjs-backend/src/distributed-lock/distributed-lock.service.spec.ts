import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CacheService } from '../cache/cache.service';
import { DistributedLockService } from './distributed-lock.service';

describe('DistributedLockService', () => {
  const cache = { setnx: vi.fn(), get: vi.fn(), del: vi.fn() };
  const config = { get: vi.fn() };
  const newService = () =>
    new DistributedLockService(
      cache as unknown as CacheService,
      config as unknown as ConfigService
    );

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('with Redis', () => {
    const useRedis = () => config.get.mockReturnValue({ provider: 'redis' });

    it('runs the task when the lock is acquired', async () => {
      useRedis();
      cache.setnx.mockResolvedValue(true);
      const task = vi.fn().mockResolvedValue(undefined);

      const ran = await newService().runExclusive('seed', 60, task);

      expect(ran).toBe(true);
      expect(cache.setnx).toHaveBeenCalledWith('lock:seed', expect.any(String), 60);
      expect(task).toHaveBeenCalledOnce();
    });

    it('skips the task when another instance holds the lock', async () => {
      useRedis();
      cache.setnx.mockResolvedValue(false);
      const task = vi.fn();

      const ran = await newService().runExclusive('seed', 60, task);

      expect(ran).toBe(false);
      expect(task).not.toHaveBeenCalled();
    });

    it('releases the lock it owns after the task', async () => {
      useRedis();
      cache.setnx.mockResolvedValue(true);
      // Mirror Redis: `get` returns the value `setnx` stored.
      cache.get.mockImplementation(async () => cache.setnx.mock.calls[0]?.[1]);

      await newService().runExclusive('seed', 60, vi.fn().mockResolvedValue(undefined));

      expect(cache.del).toHaveBeenCalledWith('lock:seed');
    });

    it('releases the lock even when the task throws', async () => {
      useRedis();
      cache.setnx.mockResolvedValue(true);
      cache.get.mockImplementation(async () => cache.setnx.mock.calls[0]?.[1]);
      const task = vi.fn().mockRejectedValue(new Error('boom'));

      await expect(newService().runExclusive('seed', 60, task)).rejects.toThrow('boom');
      expect(cache.del).toHaveBeenCalledWith('lock:seed');
    });

    it('does not release a lock owned by another instance', async () => {
      useRedis();
      cache.setnx.mockResolvedValue(true);
      cache.get.mockResolvedValue('another-instance');

      await newService().runExclusive('seed', 60, vi.fn().mockResolvedValue(undefined));

      expect(cache.del).not.toHaveBeenCalled();
    });

    it('runs the task anyway when acquiring the lock errors', async () => {
      useRedis();
      cache.setnx.mockRejectedValue(new Error('redis down'));
      const task = vi.fn().mockResolvedValue(undefined);

      const ran = await newService().runExclusive('seed', 60, task);

      expect(ran).toBe(true);
      expect(task).toHaveBeenCalledOnce();
    });
  });

  describe('without Redis', () => {
    it('runs the task without acquiring a lock', async () => {
      config.get.mockReturnValue({ provider: 'memory' });
      const task = vi.fn().mockResolvedValue(undefined);

      const ran = await newService().runExclusive('seed', 60, task);

      expect(ran).toBe(true);
      expect(cache.setnx).not.toHaveBeenCalled();
      expect(task).toHaveBeenCalledOnce();
    });
  });
});
