import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';

export type ComputedUpdateLockConfig = {
  enabled: boolean;
  maxRecordLocks: number;
};

export const defaultComputedUpdateLockConfig: ComputedUpdateLockConfig = {
  enabled: true,
  maxRecordLocks: 50,
};

export type ComputedUpdateLockSummary = {
  mode: 'disabled' | 'none' | 'record' | 'table' | 'mixed';
  totalLocks: number;
  recordLocks: number;
  tableLocks: number;
  tableLockTableIds: string[];
  seedRecordCount: number;
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

export type ComputedUpdateLockStatement = {
  scope: 'record' | 'table';
  tableId: string;
  recordId?: string;
  key: string;
  sql: string;
  parameters: ReadonlyArray<unknown>;
};

export type ComputedUpdateLockPlan = {
  summary: ComputedUpdateLockSummary;
  reason: string;
  recordLocks: ReadonlyArray<ComputedUpdateLockRecord>;
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
        tableLocks: 0,
        tableLockTableIds: [],
        seedRecordCount,
      },
      reason: 'locks disabled by config',
      recordLocks: [],
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
        tableLocks: 0,
        tableLockTableIds: [],
        seedRecordCount: 0,
      },
      reason: 'no seed records to lock',
      recordLocks: [],
      tableLocks: [],
      statements: [],
    };
  }

  const recordLimit = config.maxRecordLocks;
  const recordLocks: ComputedUpdateLockRecord[] = [];
  const tableLocks: ComputedUpdateLockTable[] = [];
  const tableLockTableIds: string[] = [];
  const baseId = plan.baseId.toString();

  for (const group of seedGroups) {
    if (group.recordIds.length === 0) continue;
    if (recordLimit <= 0 || group.recordIds.length > recordLimit) {
      tableLockTableIds.push(group.tableId);
      tableLocks.push({
        tableId: group.tableId,
        key: buildTableLockKey(baseId, group.tableId),
      });
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

  const statements = buildStatements(recordLocks, tableLocks);
  const summary: ComputedUpdateLockSummary = {
    mode: resolveLockMode(tableLocks.length, recordLocks.length),
    totalLocks: statements.length,
    recordLocks: recordLocks.length,
    tableLocks: tableLocks.length,
    tableLockTableIds: [...new Set(tableLockTableIds)].sort(),
    seedRecordCount,
  };

  return {
    summary,
    reason: buildLockReason(summary, config),
    recordLocks: recordLocks.sort((a, b) => a.key.localeCompare(b.key)),
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

const buildTableLockKey = (baseId: string, tableId: string): string =>
  `v2:computed:${baseId}:${tableId}`;

const resolveLockMode = (
  tableLocks: number,
  recordLocks: number
): ComputedUpdateLockSummary['mode'] => {
  if (tableLocks === 0 && recordLocks === 0) return 'none';
  if (tableLocks > 0 && recordLocks > 0) return 'mixed';
  if (tableLocks > 0) return 'table';
  return 'record';
};

const buildStatements = (
  recordLocks: ReadonlyArray<ComputedUpdateLockRecord>,
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

const buildLockReason = (
  summary: ComputedUpdateLockSummary,
  config: ComputedUpdateLockConfig
): string => {
  if (summary.mode === 'disabled') return 'locks disabled by config';
  if (summary.mode === 'none') return 'no seed records to lock';
  if (summary.mode === 'record') {
    return `lock seed records to serialize computed updates (maxRecordLocks=${config.maxRecordLocks})`;
  }
  if (summary.mode === 'table') {
    return `seed record count per table exceeded maxRecordLocks=${config.maxRecordLocks}; table locks serialize computed updates`;
  }
  return `mixed locks: some tables exceeded maxRecordLocks=${config.maxRecordLocks}; lock tables and remaining records`;
};
