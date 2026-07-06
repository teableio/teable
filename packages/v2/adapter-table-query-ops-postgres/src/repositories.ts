import { domainError, type DomainError, type IExecutionContext, type Table } from '@teable/v2-core';
import {
  TablePhysicalStats,
  TableQueryObservationWindow,
  TableQueryRecommendation,
  TableQueryRemediationTask,
  TableQueryShape,
  type ExecutablePhase1RemediationKind,
  type TableQuerySqlDiagnostic,
} from '@teable/v2-table-query-ops';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import { getTablePhysicalName, toInfrastructureError } from './helpers';
import type { TableQueryOpsDatabase } from './schema';
import type { UnknownPostgresDatabase } from './types';

const toJsonb = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;

export class PostgresTableQueryObservationRepository {
  constructor(private readonly db: Kysely<TableQueryOpsDatabase>) {}

  async record(
    _context: IExecutionContext,
    observation: TableQueryObservationWindow
  ): Promise<Result<void, DomainError>> {
    try {
      const snapshot = observation.snapshot();
      const queryKind = observation.shape().queryKind();
      const id = `${snapshot.tableId}:${queryKind}:${snapshot.shapeHash}:${snapshot.windowStart.toISOString()}`;
      await this.db
        .insertInto('table_query_observation_window')
        .values({
          id,
          space_id: snapshot.spaceId ?? null,
          base_id: snapshot.baseId,
          table_id: snapshot.tableId,
          query_kind: queryKind,
          shape_hash: snapshot.shapeHash,
          window_start: snapshot.windowStart,
          window_size_seconds: snapshot.windowSizeSeconds,
          request_count: snapshot.requestCount,
          slow_count: snapshot.slowCount,
          timeout_count: snapshot.timeoutCount,
          db_error_count: snapshot.dbErrorCount,
          total_duration_ms: snapshot.totalDurationMs,
          max_duration_ms: snapshot.maxDurationMs,
          total_db_duration_ms: snapshot.totalDbDurationMs ?? null,
          max_db_duration_ms: snapshot.maxDbDurationMs ?? null,
          shape: toJsonb(snapshot.shape),
          sql_diagnostics: snapshot.sqlDiagnostics ? toJsonb(snapshot.sqlDiagnostics) : null,
        })
        .onConflict((oc) =>
          oc.columns(['table_id', 'query_kind', 'shape_hash', 'window_start']).doUpdateSet({
            request_count: sql`table_query_observation_window.request_count + excluded.request_count`,
            slow_count: sql`table_query_observation_window.slow_count + excluded.slow_count`,
            timeout_count: sql`table_query_observation_window.timeout_count + excluded.timeout_count`,
            db_error_count: sql`table_query_observation_window.db_error_count + excluded.db_error_count`,
            total_duration_ms: sql`table_query_observation_window.total_duration_ms + excluded.total_duration_ms`,
            max_duration_ms: sql`greatest(table_query_observation_window.max_duration_ms, excluded.max_duration_ms)`,
            total_db_duration_ms: sql`coalesce(table_query_observation_window.total_db_duration_ms, 0) + coalesce(excluded.total_db_duration_ms, 0)`,
            max_db_duration_ms: sql`greatest(coalesce(table_query_observation_window.max_db_duration_ms, 0), coalesce(excluded.max_db_duration_ms, 0))`,
            sql_diagnostics: sql`coalesce(excluded.sql_diagnostics, table_query_observation_window.sql_diagnostics)`,
            last_modified_time: sql`now()`,
          })
        )
        .execute();
      return ok(undefined);
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to record table query observation'));
    }
  }

  async findRecent(
    _context: IExecutionContext,
    input: { readonly since: Date; readonly limit: number; readonly tableId?: string }
  ): Promise<Result<ReadonlyArray<TableQueryObservationWindow>, DomainError>> {
    try {
      let query = this.db
        .selectFrom('table_query_observation_window')
        .selectAll()
        .where('window_start', '>=', input.since)
        .orderBy('window_start', 'desc')
        .limit(input.limit);
      if (input.tableId) {
        query = query.where('table_id', '=', input.tableId);
      }
      const rows = await query.execute();
      const windows: TableQueryObservationWindow[] = [];
      for (const row of rows) {
        const observation = rowToObservation(row);
        if (observation.isErr()) return err(observation.error);
        windows.push(observation.value);
      }
      return ok(windows);
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to read table query observations'));
    }
  }
}

export class PostgresTablePhysicalStatsReader {
  constructor(private readonly dataDb: Kysely<UnknownPostgresDatabase>) {}

  async read(
    _context: IExecutionContext,
    table: Table
  ): Promise<Result<TablePhysicalStats, DomainError>> {
    const physical = getTablePhysicalName(table);
    if (physical.isErr()) return err(physical.error);
    try {
      const result = await sql<{
        estimated_rows: string | number | null;
        total_bytes: string | number | null;
        seq_scan_count: string | number | null;
        index_scan_count: string | number | null;
        last_analyze_at: Date | null;
      }>`
        SELECT
          coalesce(c.reltuples, 0) AS estimated_rows,
          pg_total_relation_size(c.oid) AS total_bytes,
          coalesce(s.seq_scan, 0) AS seq_scan_count,
          coalesce(s.idx_scan, 0) AS index_scan_count,
          s.last_analyze AS last_analyze_at
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
        WHERE n.nspname = ${physical.value.schema}
          AND c.relname = ${physical.value.tableName}
        LIMIT 1
      `.execute(this.dataDb);
      const row = result.rows[0];
      if (!row) {
        return err(domainError.notFound({ message: 'Physical table stats not found' }));
      }
      return TablePhysicalStats.create({
        estimatedRows: Number(row.estimated_rows ?? 0),
        totalBytes: Number(row.total_bytes ?? 0),
        seqScanCount: Number(row.seq_scan_count ?? 0),
        indexScanCount: Number(row.index_scan_count ?? 0),
        lastAnalyzeAt: row.last_analyze_at ?? undefined,
      });
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to read table physical stats'));
    }
  }
}

export class PostgresTableQueryRecommendationRepository {
  constructor(private readonly db: Kysely<TableQueryOpsDatabase>) {}

  async findOpenByShape(
    _context: IExecutionContext,
    input: { readonly tableId: string; readonly shapeHash: string; readonly policyVersion: string }
  ): Promise<Result<TableQueryRecommendation | undefined, DomainError>> {
    try {
      const row = await this.db
        .selectFrom('table_query_recommendation')
        .selectAll()
        .where('table_id', '=', input.tableId)
        .where('shape_hash', '=', input.shapeHash)
        .where('policy_version', '=', input.policyVersion)
        .where('status', '=', 'open')
        .executeTakeFirst();
      return row ? rowToRecommendation(row).map((item) => item) : ok(undefined);
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to find open table query recommendation'));
    }
  }

  async findById(
    _context: IExecutionContext,
    id: string
  ): Promise<Result<TableQueryRecommendation, DomainError>> {
    try {
      const row = await this.db
        .selectFrom('table_query_recommendation')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) return err(domainError.notFound({ message: 'Recommendation not found' }));
      return rowToRecommendation(row);
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to find table query recommendation'));
    }
  }

  async save(
    _context: IExecutionContext,
    recommendation: TableQueryRecommendation
  ): Promise<Result<TableQueryRecommendation, DomainError>> {
    const snapshot = recommendation.snapshot();
    const values = {
      id: snapshot.id,
      space_id: snapshot.spaceId ?? null,
      base_id: snapshot.baseId,
      table_id: snapshot.tableId,
      shape_hash: snapshot.shapeHash,
      policy_version: snapshot.policyVersion,
      status: snapshot.status,
      risk_level: snapshot.riskLevel,
      risk_score: snapshot.riskScore,
      reason_codes: toJsonb(snapshot.reasonCodes),
      remediation_candidates: toJsonb(snapshot.remediationCandidates),
      snapshot: toJsonb(snapshot.snapshot),
      created_time: snapshot.createdTime,
      last_modified_time: snapshot.lastModifiedTime ?? null,
    };
    const updateValues = {
      status: snapshot.status,
      risk_level: snapshot.riskLevel,
      risk_score: snapshot.riskScore,
      reason_codes: toJsonb(snapshot.reasonCodes),
      remediation_candidates: toJsonb(snapshot.remediationCandidates),
      snapshot: toJsonb(snapshot.snapshot),
      last_modified_time: snapshot.lastModifiedTime ?? new Date(),
    };
    try {
      const row =
        snapshot.status === 'open'
          ? await this.db
              .insertInto('table_query_recommendation')
              .values(values)
              .onConflict((oc) =>
                oc
                  .columns(['table_id', 'shape_hash', 'policy_version'])
                  .where('status', '=', 'open')
                  .doUpdateSet(updateValues)
              )
              .returningAll()
              .executeTakeFirstOrThrow()
          : await this.db
              .insertInto('table_query_recommendation')
              .values(values)
              .onConflict((oc) => oc.column('id').doUpdateSet(updateValues))
              .returningAll()
              .executeTakeFirstOrThrow();
      return rowToRecommendation(row);
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to save table query recommendation'));
    }
  }
}

export class PostgresTableQueryRemediationTaskRepository {
  constructor(private readonly db: Kysely<TableQueryOpsDatabase>) {}

  async findById(
    _context: IExecutionContext,
    id: string
  ): Promise<Result<TableQueryRemediationTask, DomainError>> {
    try {
      const row = await this.db
        .selectFrom('table_query_remediation_task')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) return err(domainError.notFound({ message: 'Remediation task not found' }));
      return rowToTask(row);
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to find table query remediation task'));
    }
  }

  async save(
    _context: IExecutionContext,
    task: TableQueryRemediationTask
  ): Promise<Result<TableQueryRemediationTask, DomainError>> {
    const snapshot = task.snapshot();
    try {
      await this.db
        .insertInto('table_query_remediation_task')
        .values({
          id: snapshot.id,
          recommendation_id: snapshot.recommendationId ?? null,
          base_id: snapshot.baseId,
          table_id: snapshot.tableId,
          kind: snapshot.kind,
          status: snapshot.status,
          payload: toJsonb(snapshot.payload),
          result: snapshot.result == null ? null : toJsonb(snapshot.result),
          attempts: snapshot.attempts,
          max_attempts: snapshot.maxAttempts,
          locked_at: snapshot.lockedAt ?? null,
          locked_by: snapshot.lockedBy ?? null,
          last_error: snapshot.lastError ?? null,
          created_time: snapshot.createdTime,
          last_modified_time: snapshot.lastModifiedTime ?? null,
        })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            status: snapshot.status,
            payload: toJsonb(snapshot.payload),
            result: snapshot.result == null ? null : toJsonb(snapshot.result),
            attempts: snapshot.attempts,
            locked_at: snapshot.lockedAt ?? null,
            locked_by: snapshot.lockedBy ?? null,
            last_error: snapshot.lastError ?? null,
            last_modified_time: snapshot.lastModifiedTime ?? new Date(),
          })
        )
        .execute();
      return ok(task);
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to save table query remediation task'));
    }
  }

  async claimNextAccepted(
    _context: IExecutionContext,
    input: {
      readonly workerId: string;
      readonly now: Date;
      readonly allowedKinds: ReadonlyArray<ExecutablePhase1RemediationKind>;
    }
  ): Promise<Result<TableQueryRemediationTask | undefined, DomainError>> {
    try {
      const result = await sql<TableQueryOpsDatabase['table_query_remediation_task']>`
        UPDATE table_query_remediation_task
        SET locked_by = ${input.workerId},
            locked_at = ${input.now},
            last_modified_time = ${input.now}
        WHERE id = (
          SELECT id
          FROM table_query_remediation_task
          WHERE status = 'queued'
            AND kind = ANY(${input.allowedKinds})
            AND attempts < max_attempts
            AND (locked_at IS NULL OR locked_at < ${new Date(input.now.getTime() - 60_000)})
          ORDER BY created_time ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING *
      `.execute(this.db);
      const row = result.rows[0];
      if (!row) return ok(undefined);
      return rowToTask(row);
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to claim table query remediation task'));
    }
  }
}

export class PostgresTableQueryOpsLeaseRepository {
  constructor(private readonly db: Kysely<TableQueryOpsDatabase>) {}

  async acquire(
    _context: IExecutionContext,
    input: {
      readonly leaseKey: string;
      readonly ownerId: string;
      readonly ttlMs: number;
      readonly now: Date;
    }
  ): Promise<Result<boolean, DomainError>> {
    try {
      const expiresAt = new Date(input.now.getTime() + input.ttlMs);
      const result = await sql<{ lease_key: string }>`
        INSERT INTO table_query_ops_lease (lease_key, owner_id, expires_at, updated_time)
        VALUES (${input.leaseKey}, ${input.ownerId}, ${expiresAt}, ${input.now})
        ON CONFLICT (lease_key) DO UPDATE
        SET owner_id = excluded.owner_id,
            expires_at = excluded.expires_at,
            updated_time = excluded.updated_time
        WHERE table_query_ops_lease.expires_at <= ${input.now}
           OR table_query_ops_lease.owner_id = ${input.ownerId}
        RETURNING lease_key
      `.execute(this.db);
      return ok(result.rows.length > 0);
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to acquire table query ops lease'));
    }
  }
}

const rowToObservation = (
  row: TableQueryOpsDatabase['table_query_observation_window']
): Result<TableQueryObservationWindow, DomainError> => {
  const shape = TableQueryShape.create(row.shape);
  if (shape.isErr()) return err(shape.error);
  return TableQueryObservationWindow.create({
    spaceId: row.space_id ?? undefined,
    baseId: row.base_id,
    tableId: row.table_id,
    windowStart: row.window_start,
    windowSizeSeconds: row.window_size_seconds,
    shapeHash: row.shape_hash,
    shape: shape.value,
    requestCount: row.request_count,
    slowCount: row.slow_count,
    timeoutCount: row.timeout_count,
    dbErrorCount: row.db_error_count,
    totalDurationMs: row.total_duration_ms,
    maxDurationMs: row.max_duration_ms,
    totalDbDurationMs: row.total_db_duration_ms ?? undefined,
    maxDbDurationMs: row.max_db_duration_ms ?? undefined,
    sqlDiagnostics: toSqlDiagnostics(row.sql_diagnostics),
  });
};

const toSqlDiagnostics = (value: unknown): ReadonlyArray<TableQuerySqlDiagnostic> | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is TableQuerySqlDiagnostic => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    const diagnostic = item as Partial<TableQuerySqlDiagnostic>;
    return (
      typeof diagnostic.source === 'string' &&
      typeof diagnostic.statementKind === 'string' &&
      typeof diagnostic.fingerprint === 'string' &&
      typeof diagnostic.parameterCount === 'number' &&
      typeof diagnostic.sampled === 'boolean' &&
      (diagnostic.normalizedSql === undefined || typeof diagnostic.normalizedSql === 'string')
    );
  });
};

const rowToRecommendation = (
  row: TableQueryOpsDatabase['table_query_recommendation']
): Result<TableQueryRecommendation, DomainError> =>
  TableQueryRecommendation.rehydrate({
    id: row.id,
    spaceId: row.space_id ?? undefined,
    baseId: row.base_id,
    tableId: row.table_id,
    shapeHash: row.shape_hash,
    policyVersion: row.policy_version,
    status: row.status as never,
    riskLevel: row.risk_level as never,
    riskScore: row.risk_score,
    reasonCodes: row.reason_codes as never,
    remediationCandidates: row.remediation_candidates as never,
    snapshot: row.snapshot,
    createdTime: row.created_time ?? new Date(0),
    lastModifiedTime: row.last_modified_time ?? undefined,
  });

const rowToTask = (
  row: TableQueryOpsDatabase['table_query_remediation_task']
): Result<TableQueryRemediationTask, DomainError> =>
  TableQueryRemediationTask.rehydrate({
    id: row.id,
    recommendationId: row.recommendation_id ?? undefined,
    baseId: row.base_id,
    tableId: row.table_id,
    kind: row.kind as never,
    status: row.status as never,
    payload: row.payload,
    result: row.result ?? undefined,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lockedAt: row.locked_at ?? undefined,
    lockedBy: row.locked_by ?? undefined,
    lastError: row.last_error ?? undefined,
    createdTime: row.created_time ?? new Date(0),
    lastModifiedTime: row.last_modified_time ?? undefined,
  });
