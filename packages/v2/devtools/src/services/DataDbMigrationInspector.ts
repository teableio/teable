import type { Effect } from 'effect';
import { Context } from 'effect';
import type { CliError } from '../errors';
import type { CliTable } from './ComputedTaskInspector';

export interface DataDbMigrationStatusInput {
  readonly spaceId?: string;
  readonly jobId?: string;
  readonly includeHistory?: boolean;
  readonly limit?: number;
}

export interface DataDbMigrationStatusRawRow {
  readonly jobId: string;
  readonly spaceId: string;
  readonly state: string;
  readonly targetMode: string;
  readonly targetConnectionId: string | null;
  readonly targetHost: string | null;
  readonly targetDatabase: string | null;
  readonly targetInternalSchema: string;
  readonly copyStats: unknown;
  readonly validationStats: unknown;
  readonly lastError: string | null;
  readonly startedAt: Date | string | null;
  readonly completedAt: Date | string | null;
  readonly createdTime: Date | string;
  readonly lastModifiedTime: Date | string | null;
}

export interface DataDbMigrationStatusRow {
  readonly jobId: string;
  readonly spaceId: string;
  readonly state: string;
  readonly targetMode: string;
  readonly targetConnectionId: string | null;
  readonly targetHost: string | null;
  readonly targetDatabase: string | null;
  readonly targetInternalSchema: string;
  readonly phase: string | null;
  readonly percent: number | null;
  readonly estimatedTotalBytes: number | null;
  readonly completedEstimatedBytes: number | null;
  readonly estimatedTotalRows: number | null;
  readonly completedEstimatedRows: number | null;
  readonly etaMs: number | null;
  readonly validationPhase: string | null;
  readonly baseCheckCount: number | null;
  readonly sharedCheckCount: number | null;
  readonly mismatchCount: number | null;
  readonly rollbackEligible: boolean | null;
  readonly rollbackFindingCount: number | null;
  readonly rollbackSwitchedAt: string | null;
  readonly rollbackCheckedAt: string | null;
  readonly lastError: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly createdTime: string;
  readonly lastModifiedTime: string | null;
}

export interface DataDbMigrationStatusOutput {
  readonly snapshotAt: string;
  readonly filters: {
    readonly spaceId?: string;
    readonly jobId?: string;
    readonly includeHistory: boolean;
    readonly limit: number;
  };
  readonly total: number;
  readonly migrationTable: CliTable<DataDbMigrationStatusRow>;
  readonly notes: ReadonlyArray<string>;
}

export class DataDbMigrationInspector extends Context.Tag('DataDbMigrationInspector')<
  DataDbMigrationInspector,
  {
    readonly getStatus: (
      input: DataDbMigrationStatusInput
    ) => Effect.Effect<DataDbMigrationStatusOutput, CliError>;
  }
>() {}

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const parseJsonRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const toNumberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const getProgress = (stats: Record<string, unknown> | undefined) =>
  parseJsonRecord(stats?.progress);

export const toDataDbMigrationStatusRow = (
  row: DataDbMigrationStatusRawRow
): DataDbMigrationStatusRow => {
  const copyStats = parseJsonRecord(row.copyStats);
  const validationStats = parseJsonRecord(row.validationStats);
  const progress = getProgress(copyStats) ?? getProgress(validationStats);
  const rollback = parseJsonRecord(validationStats?.rollback);

  return {
    jobId: row.jobId,
    spaceId: row.spaceId,
    state: row.state,
    targetMode: row.targetMode,
    targetConnectionId: row.targetConnectionId,
    targetHost: row.targetHost,
    targetDatabase: row.targetDatabase,
    targetInternalSchema: row.targetInternalSchema,
    phase:
      (typeof progress?.phase === 'string' ? progress.phase : null) ??
      (typeof copyStats?.phase === 'string' ? copyStats.phase : null) ??
      (typeof validationStats?.phase === 'string' ? validationStats.phase : null),
    percent: toNumberOrNull(progress?.percent),
    estimatedTotalBytes: toNumberOrNull(progress?.estimatedTotalBytes),
    completedEstimatedBytes: toNumberOrNull(progress?.completedEstimatedBytes),
    estimatedTotalRows: toNumberOrNull(progress?.estimatedTotalRows),
    completedEstimatedRows: toNumberOrNull(progress?.completedEstimatedRows),
    etaMs: toNumberOrNull(progress?.etaMs),
    validationPhase: typeof validationStats?.phase === 'string' ? validationStats.phase : null,
    baseCheckCount: Array.isArray(validationStats?.baseSchemas)
      ? validationStats.baseSchemas.length
      : null,
    sharedCheckCount: Array.isArray(validationStats?.sharedTables)
      ? validationStats.sharedTables.length
      : null,
    mismatchCount: Array.isArray(validationStats?.mismatches)
      ? validationStats.mismatches.length
      : null,
    rollbackEligible: typeof rollback?.eligible === 'boolean' ? rollback.eligible : null,
    rollbackFindingCount: Array.isArray(rollback?.findings) ? rollback.findings.length : null,
    rollbackSwitchedAt: typeof rollback?.switchedAt === 'string' ? rollback.switchedAt : null,
    rollbackCheckedAt: typeof rollback?.checkedAt === 'string' ? rollback.checkedAt : null,
    lastError: row.lastError,
    startedAt: toIso(row.startedAt),
    completedAt: toIso(row.completedAt),
    createdTime: toIso(row.createdTime) ?? '',
    lastModifiedTime: toIso(row.lastModifiedTime),
  };
};
