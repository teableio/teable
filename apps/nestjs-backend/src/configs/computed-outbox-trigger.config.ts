/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const readComputedOutboxBoolean = (
  value: string | undefined,
  fallback: boolean
): boolean => {
  if (value == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

const readPositiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const computedOutboxTriggerConfig = registerAs('computedOutboxTrigger', () => {
  return {
    producerEnabled: readComputedOutboxBoolean(
      process.env.V2_COMPUTED_OUTBOX_TRIGGER_PRODUCER_ENABLED,
      true
    ),
    consumerEnabled: readComputedOutboxBoolean(
      process.env.V2_COMPUTED_OUTBOX_TRIGGER_CONSUMER_ENABLED,
      true
    ),
    concurrency: readPositiveInteger(process.env.V2_COMPUTED_OUTBOX_TRIGGER_CONCURRENCY, 8),
    publishTimeoutMs: readPositiveInteger(
      process.env.V2_COMPUTED_OUTBOX_TRIGGER_PUBLISH_TIMEOUT_MS,
      1000
    ),
    monitorConcurrency: readPositiveInteger(process.env.V2_COMPUTED_OUTBOX_MONITOR_CONCURRENCY, 4),
    monitorIntervalMs: readPositiveInteger(
      process.env.V2_COMPUTED_OUTBOX_MONITOR_INTERVAL_MS,
      30_000
    ),
  };
});

export const ComputedOutboxTriggerConfig = () => Inject(computedOutboxTriggerConfig.KEY);
export type IComputedOutboxTriggerConfig = ConfigType<typeof computedOutboxTriggerConfig>;
