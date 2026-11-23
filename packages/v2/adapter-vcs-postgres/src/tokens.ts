import { createToken } from '@teable/v2-di';
import { v2VcsServerTokens } from '@teable/v2-vcs/server';

export interface IV2VcsPostgresAdapterConfig {
  /** TTL (ms) for caching positive `isEnabled === true` lookups. Negative `false` results are never cached. */
  readonly enabledCacheTtlMs?: number;
  /** Maximum time (ms) `enable()` / `capturePullCursor()` waits for pre-enable transactions to pass `enabled_barrier_xid`. */
  readonly enableQuiesceTimeoutMs?: number;
  /** Poll interval (ms) while waiting for `pg_snapshot_xmin >= enabled_barrier_xid`. */
  readonly enableQuiescePollIntervalMs?: number;
  /** Whether `appendChanges` serializes full JSON payloads into `before_value`/`after_value` (default `false`). */
  readonly storeChangePayloads?: boolean;
  /** Automatic compaction interval in push commits (`0` disables auto-compaction, default `50`). */
  readonly compactionIntervalCommits?: number;
}

export const v2VcsPostgresTokens = {
  config: createToken<IV2VcsPostgresAdapterConfig>('v2.vcs.postgres.config'),
  logRepository: v2VcsServerTokens.logRepository,
} as const;
