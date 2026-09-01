import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';

export type ComputedUpdateLockConfig = {
  enabled: boolean;
  /**
   * Per-write-table cap on exclusive per-record advisory keys (T6747).
   * At or below this size, the planner takes a shared table covering lock plus
   * one exclusive key per record so overlapping small/large cascades still
   * collide (T6637) without false-sharing unrelated small rows (T6706).
   * Above this size, only an exclusive table lock is taken so a 20k/30k host
   * fan-out cannot exhaust Postgres' lock table.
   * When <= 0, per-record keys are uncapped (legacy / tests).
   */
  maxRecordLocks: number;
  /**
   * When <= 0, every group falls back to one exclusive table-scoped advisory
   * lock. When > 0, small groups use per-record keys and large groups use the
   * maxRecordLocks table-lock fallback. The value is no longer a shard count.
   */
  batchShardCount: number;
};

export const defaultComputedUpdateLockConfig: ComputedUpdateLockConfig = {
  enabled: true,
  maxRecordLocks: 50,
  batchShardCount: 64,
};

export type ComputedUpdateLockSummary = {
  mode: 'disabled' | 'none' | 'record' | 'batch' | 'table' | 'mixed';
  totalLocks: number;
  recordLocks: number;
  batchLocks: number;
  tableLocks: number;
  tableLockTableIds: string[];
  seedRecordCount: number;
  batchShardCount: number;
};

export type ComputedUpdateLockRecord = {
  tableId: string;
  recordId: string;
  key: string;
};

export type ComputedUpdateLockTable = {
  tableId: string;
  key: string;
};

export type ComputedUpdateLockBatch = {
  tableId: string;
  batchId: string;
  key: string;
  recordCount: number;
};

export type ComputedUpdateLockStatement = {
  scope: 'record' | 'batch' | 'table';
  tableId: string;
  recordId?: string;
  batchId?: string;
  key: string;
  /**
   * Shared advisory mode is used only for the small-set table covering lock.
   * Exclusive table locks and every record/batch key stay exclusive.
   */
  shared: boolean;
  sql: string;
  parameters: ReadonlyArray<unknown>;
};

export type ComputedUpdateLockPlan = {
  summary: ComputedUpdateLockSummary;
  reason: string;
  recordLocks: ReadonlyArray<ComputedUpdateLockRecord>;
  batchLocks: ReadonlyArray<ComputedUpdateLockBatch>;
  tableLocks: ReadonlyArray<ComputedUpdateLockTable>;
  statements: ReadonlyArray<ComputedUpdateLockStatement>;
};

// The trailing constant column splits pg_stat_statements/PI fingerprints per lock scope:
// queryid ignores comments and constant values, but jumbles constant types and target
// arity, and aliases stay visible in the normalized query text. Outbox locks carry their
// own labels (see ComputedUpdateOutbox), so lock waits are attributable per scope.
const ADVISORY_LOCK_SQL =
  "select pg_advisory_xact_lock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint), 'computed' as lock_scope";
const ADVISORY_LOCK_SHARED_SQL =
  "select pg_advisory_xact_lock_shared(('x' || substr(md5($1), 1, 16))::bit(64)::bigint), 'computed' as lock_scope";
export const COMPUTED_UPDATE_LOCK_UNAVAILABLE_CODE = 'computed_update.lock_unavailable';

type SeedRecordGroup = {
  tableId: string;
  recordIds: ReadonlyArray<string>;
};

export const buildComputedUpdateLockPlan = (
  plan: {
    baseId: { toString(): string };
    seedTableId: { toString(): string };
    seedRecordIds: ReadonlyArray<{ toString(): string }>;
    extraSeedRecords: ReadonlyArray<{
      tableId: { toString(): string };
      recordIds: ReadonlyArray<{ toString(): string }>;
    }>;
  },
  config: ComputedUpdateLockConfig,
  options?: {
    /**
     * Tables this plan will write computed columns on. Extra seeds on other
     * tables are read-only foreign sources and must not take advisory locks —
     * otherwise a 1-row Order insert waits on an in-flight User fan-out that
     * only holds the User row.
     */
    writeTableIds?: ReadonlyArray<string>;
  }
): ComputedUpdateLockPlan => {
  const seedGroups = collectSeedRecordGroups(plan, options?.writeTableIds);
  const seedRecordCount = seedGroups.reduce((sum, group) => sum + group.recordIds.length, 0);

  if (!config.enabled) {
    return {
      summary: {
        mode: 'disabled',
        totalLocks: 0,
        recordLocks: 0,
        batchLocks: 0,
        tableLocks: 0,
        tableLockTableIds: [],
        seedRecordCount,
        batchShardCount: config.batchShardCount,
      },
      reason: 'locks disabled by config',
      recordLocks: [],
      batchLocks: [],
      tableLocks: [],
      statements: [],
    };
  }
  if (seedRecordCount === 0) {
    return {
      summary: {
        mode: 'none',
        totalLocks: 0,
        recordLocks: 0,
        batchLocks: 0,
        tableLocks: 0,
        tableLockTableIds: [],
        seedRecordCount: 0,
        batchShardCount: config.batchShardCount,
      },
      reason: 'no seed records to lock',
      recordLocks: [],
      batchLocks: [],
      tableLocks: [],
      statements: [],
    };
  }

  const batchShardCount = config.batchShardCount;
  const recordLocks: ComputedUpdateLockRecord[] = [];
  const batchLocks: ComputedUpdateLockBatch[] = [];
  const tableLocks: ComputedUpdateLockTable[] = [];
  const coveringSharedTableLocks: ComputedUpdateLockTable[] = [];
  const tableLockTableIds: string[] = [];

  for (const group of seedGroups) {
    if (group.recordIds.length === 0) continue;
    // Hierarchical locking (T6747):
    // - Small sets: shared table covering lock + exclusive per-record keys.
    //   Shared covering locks compose, so concurrent small updates on
    //   different rows do not false-share (T6706). Exclusive table fallback
    //   conflicts with that covering lock, so a 1-row cascade still serializes
    //   with a 20k-row fan-out on the same table (T6637).
    // - Large sets: exclusive table lock only. Per-record keys at 20k/30k
    //   hosts exhaust Postgres' lock table (`out of shared memory`).
    if (usesExclusiveTableLock(group.recordIds.length, config)) {
      tableLockTableIds.push(group.tableId);
      tableLocks.push({
        tableId: group.tableId,
        key: buildTableLockKey(group.tableId),
      });
      continue;
    }
    coveringSharedTableLocks.push({
      tableId: group.tableId,
      key: buildTableLockKey(group.tableId),
    });
    for (const recordId of group.recordIds) {
      recordLocks.push({
        tableId: group.tableId,
        recordId,
        key: buildRecordLockKey(group.tableId, recordId),
      });
    }
  }

  const statements = buildStatements(recordLocks, batchLocks, tableLocks, coveringSharedTableLocks);
  const summary: ComputedUpdateLockSummary = {
    mode: resolveLockMode(tableLocks.length, batchLocks.length, recordLocks.length),
    totalLocks: statements.length,
    recordLocks: recordLocks.length,
    batchLocks: batchLocks.length,
    tableLocks: tableLocks.length,
    tableLockTableIds: [...new Set(tableLockTableIds)].sort(),
    seedRecordCount,
    batchShardCount,
  };

  return {
    summary,
    reason: buildLockReason(summary, config),
    recordLocks: recordLocks.sort((a, b) => a.key.localeCompare(b.key)),
    batchLocks: batchLocks.sort((a, b) => a.key.localeCompare(b.key)),
    tableLocks: tableLocks.sort((a, b) => a.key.localeCompare(b.key)),
    statements,
  };
};

// The advisory key a single record's cascade contends on. Tests and tooling that
// need to collide with a computed update's lock (e.g. holding it to exercise the
// lock-miss requeue path) must derive it here instead of hand-building key strings.
export const computedUpdateLockKeyForRecord = (
  tableId: string,
  recordId: string,
  batchShardCount: number = defaultComputedUpdateLockConfig.batchShardCount
): string => {
  if (batchShardCount <= 0) return buildTableLockKey(tableId);
  return buildRecordLockKey(tableId, recordId);
};

export const buildAdvisoryLockStatement = (key: string, options?: { shared?: boolean }) => ({
  sql: options?.shared ? ADVISORY_LOCK_SHARED_SQL : ADVISORY_LOCK_SQL,
  parameters: [key] as const,
});

export const buildAdvisoryLockQuery = <DB>(db: Kysely<DB> | Transaction<DB>, key: string) =>
  sql`select pg_advisory_xact_lock(
    ('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint
  ), 'computed' as lock_scope`.compile(db);

export const buildSharedAdvisoryLockQuery = <DB>(db: Kysely<DB> | Transaction<DB>, key: string) =>
  sql`select pg_advisory_xact_lock_shared(
    ('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint
  ), 'computed' as lock_scope`.compile(db);

// Single-column shape is the computed-scope try fingerprint; outbox try locks add a
// scope column so they never share this queryid.
export const buildTryAdvisoryLockQuery = <DB>(db: Kysely<DB> | Transaction<DB>, key: string) =>
  sql<{ locked: boolean }>`select pg_try_advisory_xact_lock(
    ('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint
  ) as locked`.compile(db);

export const buildTrySharedAdvisoryLockQuery = <DB>(
  db: Kysely<DB> | Transaction<DB>,
  key: string
) =>
  sql<{ locked: boolean }>`select pg_try_advisory_xact_lock_shared(
    ('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint
  ) as locked`.compile(db);

// Batched variants collapse the per-key round-trip fan-out (up to maxRecordLocks +
// batchShardCount keys per acquire) into one statement. The inner subquery orders by
// unnest ordinality so locks are still taken in the caller's sorted key order, which is
// what prevents lock-order deadlocks between concurrent tasks.
export const buildAdvisoryLockBatchQuery = <DB>(
  db: Kysely<DB> | Transaction<DB>,
  keys: ReadonlyArray<string>
) =>
  sql`select pg_advisory_xact_lock(k.lock_key), 'computed' as lock_scope
  from (
    select ('x' || substr(md5(t.key), 1, 16))::bit(64)::bigint as lock_key
    from unnest(${sql.val(keys)}::text[]) with ordinality as t(key, ord)
    order by t.ord
  ) k`.compile(db);

// Returns one row per key. pg_try_advisory_xact_lock does not short-circuit, so keys
// after the first failure may still be acquired; they are transaction-scoped and drop
// on the rollback the caller performs when any key reports locked=false.
export const buildTryAdvisoryLockBatchQuery = <DB>(
  db: Kysely<DB> | Transaction<DB>,
  keys: ReadonlyArray<string>
) =>
  sql<{
    key: string;
    locked: boolean;
  }>`select k.key as key, pg_try_advisory_xact_lock(k.lock_key) as locked
  from (
    select t.key as key, ('x' || substr(md5(t.key), 1, 16))::bit(64)::bigint as lock_key
    from unnest(${sql.val(keys)}::text[]) with ordinality as t(key, ord)
    order by t.ord
  ) k`.compile(db);

export const isComputedUpdateLockUnavailable = (error: { code?: string }): boolean =>
  error.code === COMPUTED_UPDATE_LOCK_UNAVAILABLE_CODE;

const collectSeedRecordGroups = (
  plan: {
    seedTableId: { toString(): string };
    seedRecordIds: ReadonlyArray<{ toString(): string }>;
    extraSeedRecords: ReadonlyArray<{
      tableId: { toString(): string };
      recordIds: ReadonlyArray<{ toString(): string }>;
    }>;
  },
  writeTableIds?: ReadonlyArray<string>
): ReadonlyArray<SeedRecordGroup> => {
  const groups = new Map<string, { tableId: string; recordIds: Map<string, string> }>();
  const addGroup = (tableId: string, recordIds: ReadonlyArray<{ toString(): string }>) => {
    if (recordIds.length === 0) return;
    const entry = groups.get(tableId) ?? { tableId, recordIds: new Map() };
    for (const recordId of recordIds) {
      entry.recordIds.set(recordId.toString(), recordId.toString());
    }
    groups.set(tableId, entry);
  };

  addGroup(plan.seedTableId.toString(), plan.seedRecordIds);
  for (const group of plan.extraSeedRecords) {
    addGroup(group.tableId.toString(), group.recordIds);
  }

  const writeTables =
    writeTableIds && writeTableIds.length > 0 ? new Set(writeTableIds) : undefined;

  return [...groups.values()]
    .filter((entry) => !writeTables || writeTables.has(entry.tableId))
    .map((entry) => ({
      tableId: entry.tableId,
      recordIds: [...entry.recordIds.values()],
    }))
    .sort((a, b) => a.tableId.localeCompare(b.tableId));
};

// Table IDs are globally unique. Root-base prefixes let cross-base cascades acquire different
// advisory locks for the same physical target row, so PostgreSQL row-lock waits can consume the
// entire statement timeout. Key locks only by the records they protect.
const buildRecordLockKey = (tableId: string, recordId: string): string =>
  `v2:computed:${tableId}:record:${recordId}`;

const buildTableLockKey = (tableId: string): string => `v2:computed:${tableId}`;

const resolveLockMode = (
  tableLocks: number,
  batchLocks: number,
  recordLocks: number
): ComputedUpdateLockSummary['mode'] => {
  if (tableLocks === 0 && batchLocks === 0 && recordLocks === 0) return 'none';
  const active = [tableLocks > 0, batchLocks > 0, recordLocks > 0].filter(Boolean).length;
  if (active > 1) return 'mixed';
  if (tableLocks > 0) return 'table';
  if (batchLocks > 0) return 'batch';
  return 'record';
};

const usesExclusiveTableLock = (recordCount: number, config: ComputedUpdateLockConfig): boolean =>
  config.batchShardCount <= 0 || (config.maxRecordLocks > 0 && recordCount > config.maxRecordLocks);

const buildStatements = (
  recordLocks: ReadonlyArray<ComputedUpdateLockRecord>,
  batchLocks: ReadonlyArray<ComputedUpdateLockBatch>,
  tableLocks: ReadonlyArray<ComputedUpdateLockTable>,
  coveringSharedTableLocks: ReadonlyArray<ComputedUpdateLockTable>
): ReadonlyArray<ComputedUpdateLockStatement> => {
  const statements: ComputedUpdateLockStatement[] = [];
  const pushTable = (lock: ComputedUpdateLockTable, shared: boolean) => {
    const advisory = buildAdvisoryLockStatement(lock.key, { shared });
    statements.push({
      scope: 'table',
      tableId: lock.tableId,
      key: lock.key,
      shared,
      sql: advisory.sql,
      parameters: advisory.parameters,
    });
  };
  for (const lock of tableLocks) {
    pushTable(lock, false);
  }
  for (const lock of coveringSharedTableLocks) {
    pushTable(lock, true);
  }
  for (const lock of batchLocks) {
    const advisory = buildAdvisoryLockStatement(lock.key);
    statements.push({
      scope: 'batch',
      tableId: lock.tableId,
      batchId: lock.batchId,
      key: lock.key,
      shared: false,
      sql: advisory.sql,
      parameters: advisory.parameters,
    });
  }
  for (const lock of recordLocks) {
    const advisory = buildAdvisoryLockStatement(lock.key);
    statements.push({
      scope: 'record',
      tableId: lock.tableId,
      recordId: lock.recordId,
      key: lock.key,
      shared: false,
      sql: advisory.sql,
      parameters: advisory.parameters,
    });
  }
  return statements.sort((a, b) => a.key.localeCompare(b.key));
};

const buildLockReason = (
  summary: ComputedUpdateLockSummary,
  config: ComputedUpdateLockConfig
): string => {
  if (summary.mode === 'disabled') return 'locks disabled by config';
  if (summary.mode === 'none') return 'no seed records to lock';
  if (summary.mode === 'record') {
    return 'lock each seed/target record individually with a shared table covering lock so overlapping wide cascades still serialize';
  }
  if (summary.mode === 'batch') {
    return `lock seed records by batch shards (batchShardCount=${config.batchShardCount})`;
  }
  if (summary.mode === 'table') {
    if (config.batchShardCount <= 0) {
      return `batch sharding disabled (batchShardCount<=0); table locks serialize computed updates`;
    }
    return `seed/target set exceeds maxRecordLocks=${config.maxRecordLocks}; exclusive table lock avoids exhausting the Postgres lock table`;
  }
  return `mixed locks: per-record keys plus exclusive table locks for oversized write tables`;
};
