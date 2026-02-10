import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';

export type ComputedUpdateLockConfig = {
  enabled: boolean;
  maxRecordLocks: number;
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

const ADVISORY_LOCK_SQL =
  "select pg_advisory_xact_lock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint)";

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
  config: ComputedUpdateLockConfig
): ComputedUpdateLockPlan => {
  const seedGroups = collectSeedRecordGroups(plan);
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

  const recordLimit = config.maxRecordLocks;
  const batchShardCount = config.batchShardCount;
  const recordLocks: ComputedUpdateLockRecord[] = [];
  const batchLocks: ComputedUpdateLockBatch[] = [];
  const tableLocks: ComputedUpdateLockTable[] = [];
  const tableLockTableIds: string[] = [];
  const baseId = plan.baseId.toString();

  for (const group of seedGroups) {
    if (group.recordIds.length === 0) continue;
    if (recordLimit <= 0 || group.recordIds.length > recordLimit) {
      if (batchShardCount <= 0) {
        tableLockTableIds.push(group.tableId);
        tableLocks.push({
          tableId: group.tableId,
          key: buildTableLockKey(baseId, group.tableId),
        });
        continue;
      }
      const batchCounts = new Map<string, number>();
      const shardWidth = Math.max(1, `${Math.max(batchShardCount - 1, 0)}`.length);
      for (const recordId of group.recordIds) {
        const shard = resolveBatchShard(recordId, batchShardCount);
        const batchId = shard.toString().padStart(shardWidth, '0');
        batchCounts.set(batchId, (batchCounts.get(batchId) ?? 0) + 1);
      }
      for (const [batchId, recordCount] of batchCounts) {
        batchLocks.push({
          tableId: group.tableId,
          batchId,
          recordCount,
          key: buildBatchLockKey(baseId, group.tableId, batchId),
        });
      }
      continue;
    }
    for (const recordId of group.recordIds) {
      recordLocks.push({
        tableId: group.tableId,
        recordId,
        key: buildRecordLockKey(baseId, group.tableId, recordId),
      });
    }
  }

  const statements = buildStatements(recordLocks, batchLocks, tableLocks);
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

export const buildAdvisoryLockStatement = (key: string) => ({
  sql: ADVISORY_LOCK_SQL,
  parameters: [key] as const,
});

export const buildAdvisoryLockQuery = <DB>(db: Kysely<DB> | Transaction<DB>, key: string) =>
  sql`select pg_advisory_xact_lock(
    ('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint
  )`.compile(db);

const collectSeedRecordGroups = (plan: {
  seedTableId: { toString(): string };
  seedRecordIds: ReadonlyArray<{ toString(): string }>;
  extraSeedRecords: ReadonlyArray<{
    tableId: { toString(): string };
    recordIds: ReadonlyArray<{ toString(): string }>;
  }>;
}): ReadonlyArray<SeedRecordGroup> => {
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

  return [...groups.values()]
    .map((entry) => ({
      tableId: entry.tableId,
      recordIds: [...entry.recordIds.values()],
    }))
    .sort((a, b) => a.tableId.localeCompare(b.tableId));
};

const buildRecordLockKey = (baseId: string, tableId: string, recordId: string): string =>
  `v2:computed:${baseId}:${tableId}:${recordId}`;

const buildBatchLockKey = (baseId: string, tableId: string, batchId: string): string =>
  `v2:computed:${baseId}:${tableId}:batch:${batchId}`;

const buildTableLockKey = (baseId: string, tableId: string): string =>
  `v2:computed:${baseId}:${tableId}`;

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

const buildStatements = (
  recordLocks: ReadonlyArray<ComputedUpdateLockRecord>,
  batchLocks: ReadonlyArray<ComputedUpdateLockBatch>,
  tableLocks: ReadonlyArray<ComputedUpdateLockTable>
): ReadonlyArray<ComputedUpdateLockStatement> => {
  const statements: ComputedUpdateLockStatement[] = [];
  for (const lock of tableLocks) {
    const advisory = buildAdvisoryLockStatement(lock.key);
    statements.push({
      scope: 'table',
      tableId: lock.tableId,
      key: lock.key,
      sql: advisory.sql,
      parameters: advisory.parameters,
    });
  }
  for (const lock of batchLocks) {
    const advisory = buildAdvisoryLockStatement(lock.key);
    statements.push({
      scope: 'batch',
      tableId: lock.tableId,
      batchId: lock.batchId,
      key: lock.key,
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
      sql: advisory.sql,
      parameters: advisory.parameters,
    });
  }
  return statements.sort((a, b) => a.key.localeCompare(b.key));
};

const resolveBatchShard = (recordId: string, shardCount: number): number => {
  let hash = 2166136261;
  for (let i = 0; i < recordId.length; i += 1) {
    hash ^= recordId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % shardCount;
};

const buildLockReason = (
  summary: ComputedUpdateLockSummary,
  config: ComputedUpdateLockConfig
): string => {
  if (summary.mode === 'disabled') return 'locks disabled by config';
  if (summary.mode === 'none') return 'no seed records to lock';
  if (summary.mode === 'record') {
    return `lock seed records to serialize computed updates (maxRecordLocks=${config.maxRecordLocks})`;
  }
  if (summary.mode === 'batch') {
    return `lock seed records by batch shards (batchShardCount=${config.batchShardCount}, maxRecordLocks=${config.maxRecordLocks})`;
  }
  if (summary.mode === 'table') {
    return `seed record count per table exceeded maxRecordLocks=${config.maxRecordLocks}; table locks serialize computed updates`;
  }
  return `mixed locks: some tables exceeded maxRecordLocks=${config.maxRecordLocks}; lock tables, batch shards, and remaining records`;
};
