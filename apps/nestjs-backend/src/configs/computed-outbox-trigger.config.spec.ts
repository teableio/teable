import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  computedOutboxTriggerConfig,
  readComputedOutboxBoolean,
} from './computed-outbox-trigger.config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readComputedOutboxBoolean', () => {
  it.each(['0', 'false', 'no', 'off'])('treats %s as disabled', (value) => {
    expect(readComputedOutboxBoolean(value, true)).toBe(false);
  });

  it.each(['1', 'true', 'yes', 'on'])('treats %s as enabled', (value) => {
    expect(readComputedOutboxBoolean(value, false)).toBe(true);
  });
});

describe('computedOutboxTriggerConfig', () => {
  it('uses BullMQ producer and consumer roles by default without a polling mode', () => {
    const config = computedOutboxTriggerConfig();

    expect(config.producerEnabled).toBe(true);
    expect(config.consumerEnabled).toBe(true);
    expect(config).not.toHaveProperty('provider');
    expect(config).not.toHaveProperty('pollFallbackEnabled');
    expect(config).not.toHaveProperty('pollIntervalMs');
    expect(config).not.toHaveProperty('pollBatchSize');
  });

  it('uses a configurable read-only monitoring interval', () => {
    vi.stubEnv('V2_COMPUTED_OUTBOX_MONITOR_INTERVAL_MS', '45000');

    expect(computedOutboxTriggerConfig().monitorIntervalMs).toBe(45_000);
  });

  it('serializes computed tasks from the same seed table by default', () => {
    const config = computedOutboxTriggerConfig();

    expect(config.claimConcurrencyPerBase).toBe(2);
    expect(config.claimConcurrencyPerSeedTable).toBe(1);
  });

  it('allows an explicit per-seed concurrency override', () => {
    vi.stubEnv('V2_COMPUTED_OUTBOX_MAX_CONCURRENT_PER_SEED_TABLE', '2');

    expect(computedOutboxTriggerConfig().claimConcurrencyPerSeedTable).toBe(2);
  });

  it('exposes a positive per-base pending capacity threshold and bounded query limit', () => {
    const defaults = computedOutboxTriggerConfig();
    expect(defaults.basePendingCapacityThreshold).toBe(100);
    expect(defaults.basePendingCapacityQueryLimit).toBe(50);

    vi.stubEnv('V2_COMPUTED_OUTBOX_BASE_PENDING_CAPACITY_THRESHOLD', '37');
    vi.stubEnv('V2_COMPUTED_OUTBOX_BASE_PENDING_CAPACITY_QUERY_LIMIT', '12');
    const overridden = computedOutboxTriggerConfig();
    expect(overridden.basePendingCapacityThreshold).toBe(37);
    expect(overridden.basePendingCapacityQueryLimit).toBe(12);

    vi.stubEnv('V2_COMPUTED_OUTBOX_BASE_PENDING_CAPACITY_THRESHOLD', '0');
    vi.stubEnv('V2_COMPUTED_OUTBOX_BASE_PENDING_CAPACITY_QUERY_LIMIT', '-5');
    const invalid = computedOutboxTriggerConfig();
    expect(invalid.basePendingCapacityThreshold).toBe(100);
    expect(invalid.basePendingCapacityQueryLimit).toBe(50);

    // The resolved limit is clamped at config time so SQL, the manager slice and
    // `truncated` all share one page size.
    vi.stubEnv('V2_COMPUTED_OUTBOX_BASE_PENDING_CAPACITY_QUERY_LIMIT', '5000');
    expect(computedOutboxTriggerConfig().basePendingCapacityQueryLimit).toBe(1000);
  });
});

it('reserves shared process capacity with two compute workers by default', () => {
  vi.stubEnv('V2_COMPUTED_OUTBOX_TRIGGER_CONCURRENCY', undefined);
  expect(computedOutboxTriggerConfig().concurrency).toBe(2);
});

it('honors an explicit computed worker concurrency', () => {
  vi.stubEnv('V2_COMPUTED_OUTBOX_TRIGGER_CONCURRENCY', '6');
  expect(computedOutboxTriggerConfig().concurrency).toBe(6);
});
