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

/** HTTP and computed consumers share the process and database pools. */
export const DEFAULT_COMPUTED_OUTBOX_WORKER_CONCURRENCY = 2;

export const resolveComputedOutboxWorkerConcurrency = (): number =>
  readPositiveInteger(
    process.env.V2_COMPUTED_OUTBOX_TRIGGER_CONCURRENCY,
    DEFAULT_COMPUTED_OUTBOX_WORKER_CONCURRENCY
  );

/**
 * T8159 per-base pending capacity probe. One resolved page size is shared by the
 * config reader, the SQL builder and the manager, so the SQL sentinel row, the
 * manager slice and `truncated` can never disagree.
 */
export const MAX_BASE_PENDING_CAPACITY_QUERY_LIMIT = 1000;
export const DEFAULT_BASE_PENDING_CAPACITY_THRESHOLD = 100;
export const DEFAULT_BASE_PENDING_CAPACITY_QUERY_LIMIT = 50;

export const normalizeBasePendingCapacityQueryLimit = (limit: number): number => {
  const parsed = Math.trunc(limit);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_BASE_PENDING_CAPACITY_QUERY_LIMIT;
  return Math.min(MAX_BASE_PENDING_CAPACITY_QUERY_LIMIT, parsed);
};

export const normalizeBasePendingCapacityThreshold = (threshold: number): number => {
  const parsed = Math.trunc(threshold);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_BASE_PENDING_CAPACITY_THRESHOLD;
  return parsed;
};

export const DEFAULT_COMPUTED_OUTBOX_WRITER_CONCURRENCY = 2;
export const MAX_COMPUTED_OUTBOX_WRITER_CONCURRENCY = 8;
export const MAX_CONFIGURED_OUTBOX_WRITER_CONCURRENCY = 32;

export const resolveComputedOutboxWriterConcurrency = (
  env: Record<string, string | undefined> = process.env,
  poolMax?: number
): number => {
  const normalizedPoolMax =
    typeof poolMax === 'number' && Number.isFinite(poolMax) && poolMax > 0
      ? Math.trunc(poolMax)
      : undefined;
  const configured = Number(env.V2_COMPUTED_OUTBOX_MAX_CONCURRENT_PER_WRITER);
  if (Number.isInteger(configured) && configured > 0) {
    const capped = Math.min(MAX_CONFIGURED_OUTBOX_WRITER_CONCURRENCY, configured);
    if (normalizedPoolMax !== undefined) {
      return Math.min(capped, Math.max(1, normalizedPoolMax - 1));
    }
    return capped;
  }
  if (normalizedPoolMax !== undefined) {
    if (normalizedPoolMax <= 3) {
      return 1;
    }
    return Math.max(
      DEFAULT_COMPUTED_OUTBOX_WRITER_CONCURRENCY,
      Math.min(MAX_COMPUTED_OUTBOX_WRITER_CONCURRENCY, Math.floor(normalizedPoolMax / 2))
    );
  }
  return DEFAULT_COMPUTED_OUTBOX_WRITER_CONCURRENCY;
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
    concurrency: resolveComputedOutboxWorkerConcurrency(),
    publishTimeoutMs: readPositiveInteger(
      process.env.V2_COMPUTED_OUTBOX_TRIGGER_PUBLISH_TIMEOUT_MS,
      1000
    ),
    monitorConcurrency: readPositiveInteger(process.env.V2_COMPUTED_OUTBOX_MONITOR_CONCURRENCY, 4),
    monitorIntervalMs: readPositiveInteger(
      process.env.V2_COMPUTED_OUTBOX_MONITOR_INTERVAL_MS,
      30_000
    ),
    // Caps how many wakeups one redrive scan publishes per target. A resumed
    // pause or long outage can leave weeks of backlog; draining it in a single
    // sweep floods the claim path and the data-db pool. The remainder is
    // picked up by the following reconcile cycles.
    redriveMaxPublishPerTarget: readPositiveInteger(
      process.env.V2_COMPUTED_OUTBOX_REDRIVE_MAX_PUBLISH_PER_TARGET,
      1000
    ),
    // Cluster-wide outbox claim caps (active `processing` tasks per base / per
    // base+seed-table before further claims defer). BYODB data pools are sized
    // against these at deploy time — raise them deliberately.
    claimConcurrencyPerBase: readPositiveInteger(
      process.env.V2_COMPUTED_OUTBOX_MAX_CONCURRENT_PER_BASE,
      2
    ),
    claimConcurrencyPerSeedTable: readPositiveInteger(
      process.env.V2_COMPUTED_OUTBOX_MAX_CONCURRENT_PER_SEED_TABLE,
      1
    ),

    /**
     * T8159: a base reports when its pending capacity (due + future-dated,
     * non-paused, routed pending rows) reaches this count. The value is only a
     * measured backlog. Each paged sample returns and logs at most
     * `basePendingCapacityQueryLimit` bases, so per-sample data stays bounded;
     * the underlying grouped scan is not bounded by that limit.
     */
    basePendingCapacityThreshold: normalizeBasePendingCapacityThreshold(
      readPositiveInteger(
        process.env.V2_COMPUTED_OUTBOX_BASE_PENDING_CAPACITY_THRESHOLD,
        DEFAULT_BASE_PENDING_CAPACITY_THRESHOLD
      )
    ),
    basePendingCapacityQueryLimit: normalizeBasePendingCapacityQueryLimit(
      readPositiveInteger(
        process.env.V2_COMPUTED_OUTBOX_BASE_PENDING_CAPACITY_QUERY_LIMIT,
        DEFAULT_BASE_PENDING_CAPACITY_QUERY_LIMIT
      )
    ),
  };
});

export const ComputedOutboxTriggerConfig = () => Inject(computedOutboxTriggerConfig.KEY);
export type IComputedOutboxTriggerConfig = ConfigType<typeof computedOutboxTriggerConfig>;
