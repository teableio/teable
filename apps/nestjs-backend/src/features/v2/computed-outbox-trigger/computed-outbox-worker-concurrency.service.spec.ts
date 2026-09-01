import { describe, expect, it, vi } from 'vitest';

import {
  ComputedOutboxWorkerConcurrencyRangeError,
  ComputedOutboxWorkerConcurrencyService,
} from './computed-outbox-worker-concurrency.service';

const config = { concurrency: 8 };

const createRedis = (stored: Record<string, string> = {}) => ({
  get: vi.fn(async (key: string) => stored[key] ?? null),
  set: vi.fn(async (key: string, value: string) => {
    stored[key] = value;
    return 'OK';
  }),
  del: vi.fn(async (key: string) => {
    delete stored[key];
    return 1;
  }),
});

const createService = (redis: ReturnType<typeof createRedis>) =>
  new ComputedOutboxWorkerConcurrencyService(
    config as never,
    { client: Promise.resolve(redis) } as never
  );

describe('ComputedOutboxWorkerConcurrencyService', () => {
  it('stores the cluster-wide override and reports the effective value', async () => {
    const redis = createRedis();
    const service = createService(redis);

    await expect(service.getSnapshot()).resolves.toEqual({
      processDefault: 8,
      override: null,
      effective: 8,
      min: 1,
      max: 64,
    });

    await expect(service.setOverride(16)).resolves.toMatchObject({ override: 16, effective: 16 });
    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('worker-concurrency'), '16');
    await expect(service.getOverride()).resolves.toBe(16);

    await expect(service.setOverride(null)).resolves.toMatchObject({
      override: null,
      effective: 8,
    });
    await expect(service.getOverride()).resolves.toBeNull();
  });

  it('rejects out-of-range overrides and ignores corrupt stored values', async () => {
    const redis = createRedis();
    const service = createService(redis);

    await expect(service.setOverride(0)).rejects.toBeInstanceOf(
      ComputedOutboxWorkerConcurrencyRangeError
    );
    await expect(service.setOverride(65)).rejects.toBeInstanceOf(
      ComputedOutboxWorkerConcurrencyRangeError
    );
    await expect(service.setOverride(2.5)).rejects.toBeInstanceOf(
      ComputedOutboxWorkerConcurrencyRangeError
    );

    // A corrupt/out-of-range stored value must never be applied by consumers.
    redis.get.mockResolvedValueOnce('not-a-number');
    await expect(service.getOverride()).resolves.toBeNull();
    redis.get.mockResolvedValueOnce('9999');
    await expect(service.getOverride()).resolves.toBeNull();
  });

  it('degrades to the env default when the queue is missing or Redis fails', async () => {
    const withoutQueue = new ComputedOutboxWorkerConcurrencyService(config as never, undefined);
    await expect(withoutQueue.getOverride()).resolves.toBeNull();
    await expect(withoutQueue.setOverride(4)).rejects.toThrow('BullMQ queue is not configured');

    const redis = createRedis();
    redis.get.mockRejectedValueOnce(new Error('redis down'));
    const service = createService(redis);
    await expect(service.getOverride()).resolves.toBeNull();
  });
});
