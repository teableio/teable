import type { ComputedUpdateOutboxConfig } from '@teable/v2-adapter-table-repository-postgres';
import { defaultComputedUpdateOutboxConfig } from '@teable/v2-adapter-table-repository-postgres';
import { describe, expect, it, vi } from 'vitest';

import {
  ComputedOutboxClaimConcurrencyRangeError,
  ComputedOutboxClaimConcurrencyService,
} from './computed-outbox-claim-concurrency.service';

const config = { claimConcurrencyPerBase: 2, claimConcurrencyPerSeedTable: 2 };

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

const createService = (redis?: ReturnType<typeof createRedis>) =>
  new ComputedOutboxClaimConcurrencyService(
    config as never,
    redis ? ({ client: Promise.resolve(redis) } as never) : undefined
  );

const createOutboxConfig = (): ComputedUpdateOutboxConfig => ({
  ...defaultComputedUpdateOutboxConfig,
});

describe('ComputedOutboxClaimConcurrencyService', () => {
  it('stores the cluster-wide override and reports the effective values', async () => {
    const redis = createRedis();
    const service = createService(redis);

    await expect(service.getSnapshot()).resolves.toEqual({
      processDefault: { perBase: 2, perSeedTable: 2 },
      override: { perBase: null, perSeedTable: null },
      effective: { perBase: 2, perSeedTable: 2 },
      min: 1,
      max: 16,
    });

    await expect(service.setOverride({ perBase: 6, perSeedTable: null })).resolves.toMatchObject({
      override: { perBase: 6, perSeedTable: null },
      effective: { perBase: 6, perSeedTable: 2 },
    });
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('claim-concurrency'),
      JSON.stringify({ perBase: 6, perSeedTable: null })
    );
    await expect(service.getOverride()).resolves.toEqual({ perBase: 6, perSeedTable: null });

    // Clearing both fields deletes the key and falls back to env defaults.
    await expect(service.setOverride(null)).resolves.toMatchObject({
      override: { perBase: null, perSeedTable: null },
      effective: { perBase: 2, perSeedTable: 2 },
    });
    expect(redis.del).toHaveBeenCalled();
    await expect(service.getOverride()).resolves.toEqual({ perBase: null, perSeedTable: null });
  });

  it('hot-applies overrides to registered outbox configs and stops after unregister', async () => {
    const redis = createRedis();
    const service = createService(redis);
    const outboxConfig = createOutboxConfig();

    const unregister = service.registerOutboxConfig(outboxConfig);
    expect(outboxConfig.maxConcurrentProcessingPerBase).toBe(2);

    await service.setOverride({ perBase: 4, perSeedTable: 3 });
    expect(outboxConfig.maxConcurrentProcessingPerBase).toBe(4);
    expect(outboxConfig.maxConcurrentProcessingPerSeedTable).toBe(3);
    expect(service.effective).toEqual({ perBase: 4, perSeedTable: 3 });

    // A config registered while an override is active picks it up immediately.
    const lateConfig = createOutboxConfig();
    service.registerOutboxConfig(lateConfig);
    expect(lateConfig.maxConcurrentProcessingPerBase).toBe(4);

    unregister();
    await service.setOverride(null);
    expect(outboxConfig.maxConcurrentProcessingPerBase).toBe(4);
    expect(lateConfig.maxConcurrentProcessingPerBase).toBe(2);
  });

  it('rejects out-of-range overrides and ignores corrupt stored values', async () => {
    const redis = createRedis();
    const service = createService(redis);

    await expect(service.setOverride({ perBase: 0, perSeedTable: null })).rejects.toBeInstanceOf(
      ComputedOutboxClaimConcurrencyRangeError
    );
    await expect(service.setOverride({ perBase: null, perSeedTable: 17 })).rejects.toBeInstanceOf(
      ComputedOutboxClaimConcurrencyRangeError
    );
    await expect(service.setOverride({ perBase: 2.5, perSeedTable: null })).rejects.toBeInstanceOf(
      ComputedOutboxClaimConcurrencyRangeError
    );

    // Corrupt/out-of-range stored values must never be applied.
    redis.get.mockResolvedValueOnce('not-json');
    await expect(service.getOverride()).resolves.toEqual({ perBase: null, perSeedTable: null });
    redis.get.mockResolvedValueOnce(JSON.stringify({ perBase: 9999, perSeedTable: 'nope' }));
    await expect(service.getOverride()).resolves.toEqual({ perBase: null, perSeedTable: null });
  });

  it('degrades to env defaults when the queue is missing or Redis fails', async () => {
    const withoutQueue = createService();
    await expect(withoutQueue.getOverride()).resolves.toEqual({
      perBase: null,
      perSeedTable: null,
    });
    await expect(withoutQueue.setOverride({ perBase: 4, perSeedTable: null })).rejects.toThrow(
      'BullMQ queue is not configured'
    );
    // Registration still applies env defaults without Redis.
    const outboxConfig = createOutboxConfig();
    outboxConfig.maxConcurrentProcessingPerBase = 99;
    withoutQueue.registerOutboxConfig(outboxConfig);
    expect(outboxConfig.maxConcurrentProcessingPerBase).toBe(2);

    const redis = createRedis();
    redis.get.mockRejectedValueOnce(new Error('redis down'));
    const service = createService(redis);
    await expect(service.getOverride()).resolves.toEqual({ perBase: null, perSeedTable: null });
  });
});
