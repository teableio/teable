/**
 * Explicit runtime configuration for the computed pipeline.
 *
 * These values used to be read from `process.env` inside the adapters. That tied
 * every adapter module to a Node global (and broke browser bundles at import
 * time), so they are now plain options: the composition root decides where they
 * come from and the adapters only consume what they are given. Defaults keep the
 * documented production behaviour when nothing is supplied.
 */
export type ComputedActivityRuntimeConfig = Readonly<{
  /** Default on; `false` falls back to the synchronous projection path. */
  asyncProjection?: boolean;
  flushDebounceMs?: number;
  lockContentionLogThresholdMs?: number;
  lockContentionLogIntervalMs?: number;
}>;

export type ComputedActivityReadCacheRuntimeConfig = Readonly<{
  /** `0` disables reuse and sharing (kill switch). */
  ttlMs?: number;
  maxEntries?: number;
}>;

export type ConditionalQueryRuntimeConfig = Readonly<{
  maxLimit?: number;
  defaultLimit?: number;
}>;

export type ComputedReliabilityRuntimeConfig = Readonly<{
  /** Master switch, independent of whether a caller has resolved a Base yet. */
  enabled?: boolean;
  reconciliationEnabled?: boolean;
  /** An empty or absent allowlist means every compatible data database. */
  baseIds?: readonly string[];
  uiVisible?: boolean;
}>;

export type ComputedRuntimeConfig = Readonly<{
  workerLane?: string;
  activity?: ComputedActivityRuntimeConfig;
  activityReadCache?: ComputedActivityReadCacheRuntimeConfig;
  conditionalQuery?: ConditionalQueryRuntimeConfig;
  reliability?: ComputedReliabilityRuntimeConfig;
}>;

export const defaultComputedRuntimeConfig: ComputedRuntimeConfig = Object.freeze({});

const parseNonNegative = (
  raw: string | undefined,
  fallback: number | undefined
): number | undefined => {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
};

const parsePositive = (raw: string | undefined, fallback: number): number => {
  const parsed = parseNonNegative(raw, undefined);
  return parsed !== undefined && parsed > 0 ? parsed : fallback;
};

const parseBooleanFlag = (raw: string | undefined, fallback: boolean): boolean => {
  if (raw === undefined) return fallback;
  return raw === 'true';
};

/**
 * Maps a host environment to explicit configuration.
 *
 * Belongs to the composition root (the Node container), never to an adapter: a
 * browser passes nothing and gets the defaults.
 */
export const computedRuntimeConfigFromEnv = (
  env: Readonly<Record<string, string | undefined>>
): ComputedRuntimeConfig => {
  const workerLane = env.TEABLE_WORKER_LANE?.trim();
  const asyncProjection = env.COMPUTED_ACTIVITY_ASYNC_PROJECTION;
  const baseIds = env.COMPUTED_RELIABILITY_BASE_IDS;
  return {
    ...(workerLane ? { workerLane } : {}),
    activity: {
      ...(asyncProjection !== undefined ? { asyncProjection: asyncProjection !== 'false' } : {}),
      flushDebounceMs: parseNonNegative(env.COMPUTED_ACTIVITY_FLUSH_DEBOUNCE_MS, undefined),
      lockContentionLogThresholdMs: parseNonNegative(
        env.COMPUTED_ACTIVITY_LOCK_CONTENTION_LOG_THRESHOLD_MS,
        undefined
      ),
      lockContentionLogIntervalMs: parseNonNegative(
        env.COMPUTED_ACTIVITY_LOCK_CONTENTION_LOG_INTERVAL_MS,
        undefined
      ),
    },
    activityReadCache: {
      ttlMs: parseNonNegative(env.COMPUTED_ACTIVITY_READ_CACHE_MS, undefined),
      maxEntries: parseNonNegative(env.COMPUTED_ACTIVITY_READ_CACHE_MAX_ENTRIES, undefined),
    },
    conditionalQuery: {
      maxLimit: parsePositive(env.CONDITIONAL_QUERY_MAX_LIMIT, 5000),
      defaultLimit: parsePositive(env.CONDITIONAL_QUERY_DEFAULT_LIMIT, 5000),
    },
    reliability: {
      enabled: parseBooleanFlag(env.COMPUTED_RELIABILITY_ENABLED, true),
      reconciliationEnabled: parseBooleanFlag(
        env.COMPUTED_RELIABILITY_RECONCILIATION_ENABLED,
        true
      ),
      ...(baseIds !== undefined
        ? {
            baseIds: baseIds
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean),
          }
        : {}),
      uiVisible: parseBooleanFlag(env.COMPUTED_RELIABILITY_UI_ENABLED, true),
    },
  };
};
