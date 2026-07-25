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
});
