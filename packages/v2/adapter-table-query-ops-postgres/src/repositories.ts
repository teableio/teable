import { randomUUID } from 'node:crypto';
import { domainError, type DomainError, type IExecutionContext, type Table } from '@teable/v2-core';
import {
  TablePhysicalStats,
  TableQueryDecisionLogEntry,
  TableQueryObservationWindow,
  TableQueryRecommendation,
  TableQueryRemediationTask,
  TableQueryShape,
  type ExecutablePhase1RemediationKind,
  type TableQueryObservationBatchSink,
  type TableQuerySearchHeatByTable,
  type TableQuerySqlDiagnostic,
} from '@teable/v2-table-query-ops';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import { getTablePhysicalName, toInfrastructureError } from './helpers';
import type { TableQueryObservationDatabase, TableQueryOpsDatabase } from './schema';
import type { UnknownPostgresDatabase } from './types';

const toJsonb = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;

export type PostgresTableQueryObservationRepositoryOptions = {
  readonly lockTimeoutMs?: number;
  readonly directWriterId?: string;
  readonly readStatementTimeoutMs?: number;
  readonly statementTimeoutMs?: number;
};

const defaultObservationRepositoryOptions = {
  lockTimeoutMs: 250,
  readStatementTimeoutMs: 2_000,
  statementTimeoutMs: 500,
} as const;
type TableQueryObservationRow = Omit<
  TableQueryObservationDatabase['table_query_observation_shard'],
  'writer_id'
>;

export class PostgresTableQueryObservationRepository implements TableQueryObservationBatchSink {
  private readonly lockTimeoutMs: number;
  private readonly statementTimeoutMs: number;
  private readonly readStatementTimeoutMs: number;
  private readonly directWriterId: string;

  constructor(
    private readonly db: Kysely<TableQueryObservationDatabase>,
    options: PostgresTableQueryObservationRepositoryOptions = {}
  ) {
    this.lockTimeoutMs = options.lockTimeoutMs ?? defaultObservationRepositoryOptions.lockTimeoutMs;
    this.statementTimeoutMs =
      options.statementTimeoutMs ?? defaultObservationRepositoryOptions.statementTimeoutMs;
    this.readStatementTimeoutMs =
      options.readStatementTimeoutMs ?? defaultObservationRepositoryOptions.readStatementTimeoutMs;
    this.directWriterId = options.directWriterId ?? `direct:${randomUUID()}`;
  }

  async record(
    context: IExecutionContext,
    observation: TableQueryObservationWindow
  ): Promise<Result<void, DomainError>> {
    return this.recordBatch(context, {
      writerId: this.directWriterId,
      observations: [observation],
    });
  }

  async recordBatch(
    _context: IExecutionContext,
    input: {
      readonly writerId: string;
      readonly observations: ReadonlyArray<TableQueryObservationWindow>;
    }
  ): Promise<Result<void, DomainError>> {
    if (input.observations.length === 0) return ok(undefined);
    try {
      await this.db.transaction().execute(async (trx) => {
        await sql`
          SELECT
            set_config('lock_timeout', ${`${this.lockTimeoutMs}ms`}, true),
            set_config('statement_timeout', ${`${this.statementTimeoutMs}ms`}, true)
        `.execute(trx);
        await trx
          .insertInto('table_query_observation_shard')
          .values(
            input.observations.map((observation) => {
              const snapshot = observation.snapshot();
              const queryKind = observation.shape().queryKind();
              return {
                space_id: snapshot.spaceId ?? null,
                base_id: snapshot.baseId,
                table_id: snapshot.tableId,
                query_kind: queryKind,
                shape_hash: snapshot.shapeHash,
                window_start: snapshot.windowStart,
                writer_id: input.writerId,
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
              };
            })
          )
          .onConflict((oc) =>
            oc
              .columns(['table_id', 'query_kind', 'shape_hash', 'window_start', 'writer_id'])
              .doUpdateSet({
                request_count: sql`table_query_observation_shard.request_count + excluded.request_count`,
                slow_count: sql`table_query_observation_shard.slow_count + excluded.slow_count`,
                timeout_count: sql`table_query_observation_shard.timeout_count + excluded.timeout_count`,
                db_error_count: sql`table_query_observation_shard.db_error_count + excluded.db_error_count`,
                total_duration_ms: sql`table_query_observation_shard.total_duration_ms + excluded.total_duration_ms`,
                max_duration_ms: sql`greatest(table_query_observation_shard.max_duration_ms, excluded.max_duration_ms)`,
                total_db_duration_ms: sql`CASE
                  WHEN table_query_observation_shard.total_db_duration_ms IS NULL
                    AND excluded.total_db_duration_ms IS NULL THEN NULL
                  ELSE coalesce(table_query_observation_shard.total_db_duration_ms, 0)
                    + coalesce(excluded.total_db_duration_ms, 0)
                END`,
                max_db_duration_ms: sql`CASE
                  WHEN table_query_observation_shard.max_db_duration_ms IS NULL
                    AND excluded.max_db_duration_ms IS NULL THEN NULL
                  ELSE greatest(
                    coalesce(table_query_observation_shard.max_db_duration_ms, 0),
                    coalesce(excluded.max_db_duration_ms, 0)
                  )
                END`,
                sql_diagnostics: sql`coalesce(excluded.sql_diagnostics, table_query_observation_shard.sql_diagnostics)`,
                last_modified_time: sql`now()`,
              })
          )
          .execute();
      });
      return ok(undefined);
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to record table query observation batch'));
    }
  }

  async pruneBefore(before: Date): Promise<Result<number, DomainError>> {
    try {
      const deletedCount = await this.db.connection().execute(async (lockedDb) => {
        const lock = await sql<{ acquired: boolean }>`
          SELECT pg_try_advisory_lock(
            hashtextextended('teable:table_query_observation:prune', 0)
          ) AS acquired
        `.execute(lockedDb);
        if (!lock.rows[0]?.acquired) return 0;

        try {
          const batchSize = 1_000;
          let total = 0;
          for (;;) {
            const count = await lockedDb.transaction().execute(async (trx) => {
              await sql`
                SELECT
                  set_config('lock_timeout', ${`${this.lockTimeoutMs}ms`}, true),
                  set_config('statement_timeout', ${`${Math.max(this.statementTimeoutMs, 2_000)}ms`}, true)
              `.execute(trx);
              const batch = await sql<{ deleted_count: string | number }>`
                WITH candidates AS (
                  SELECT target.ctid
                  FROM table_query_observation_shard AS target
                  WHERE target.window_start < ${before}
                    AND (
                      target.query_kind <> 'search'
                      OR EXISTS (
                        SELECT 1
                        FROM table_query_observation_shard AS newer
                        WHERE newer.table_id = target.table_id
                          AND newer.query_kind = 'search'
                          AND newer.window_start > target.window_start
                      )
                    )
                  ORDER BY target.window_start ASC
                  LIMIT ${batchSize}
                  FOR UPDATE OF target SKIP LOCKED
                ), deleted AS (
                  DELETE FROM table_query_observation_shard AS target
                  USING candidates
                  WHERE target.ctid = candidates.ctid
                  RETURNING 1
                )
                SELECT count(*) AS deleted_count FROM deleted
              `.execute(trx);
              return Number(batch.rows[0]?.deleted_count ?? 0);
            });
            total += count;
            if (count < batchSize) return total;
          }
        } finally {
          await sql`
            SELECT pg_advisory_unlock(
              hashtextextended('teable:table_query_observation:prune', 0)
            )
          `.execute(lockedDb);
        }
      });
      return ok(deletedCount);
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to prune table query observation shards'));
    }
  }

  async findRecent(
    _context: IExecutionContext,
    input: { readonly since: Date; readonly limit: number; readonly tableId?: string }
  ): Promise<Result<ReadonlyArray<TableQueryObservationWindow>, DomainError>> {
    try {
      const tableFilter = input.tableId ? sql`AND table_id = ${input.tableId}` : sql``;
      const result = await this.db.transaction().execute(async (trx) => {
        await sql`
          SELECT set_config('statement_timeout', ${`${this.readStatementTimeoutMs}ms`}, true)
        `.execute(trx);
        return sql<TableQueryObservationRow>`
          SELECT
            (array_agg(space_id ORDER BY writer_id)
              FILTER (WHERE space_id IS NOT NULL))[1] AS space_id,
            (array_agg(base_id ORDER BY writer_id))[1] AS base_id,
            table_id,
            query_kind,
            shape_hash,
            window_start,
            (array_agg(window_size_seconds ORDER BY writer_id))[1] AS window_size_seconds,
            SUM(request_count) AS request_count,
            SUM(slow_count) AS slow_count,
            SUM(timeout_count) AS timeout_count,
            SUM(db_error_count) AS db_error_count,
            SUM(total_duration_ms) AS total_duration_ms,
            MAX(max_duration_ms) AS max_duration_ms,
            SUM(total_db_duration_ms) AS total_db_duration_ms,
            MAX(max_db_duration_ms) AS max_db_duration_ms,
            (array_agg(shape ORDER BY writer_id))[1] AS shape,
            (array_agg(sql_diagnostics ORDER BY writer_id)
              FILTER (WHERE sql_diagnostics IS NOT NULL))[1] AS sql_diagnostics,
            MIN(created_time) AS created_time,
            MAX(last_modified_time) AS last_modified_time
          FROM table_query_observation_shard
          WHERE window_start >= ${input.since}
            ${tableFilter}
          GROUP BY table_id, query_kind, shape_hash, window_start
          ORDER BY window_start DESC
          LIMIT ${input.limit}
        `.execute(trx);
      });
      const windows: TableQueryObservationWindow[] = [];
      for (const row of result.rows) {
        const observation = rowToObservation(row);
        if (observation.isErr()) return err(observation.error);
        windows.push(observation.value);
      }
      return ok(windows);
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to read table query observations'));
    }
  }

  async findSearchHeatByTable(
    _context: IExecutionContext,
    input: {
      readonly since: Date;
      readonly minSlowCount: number;
      readonly limit: number;
      readonly wideSearchFields: number;
    }
  ): Promise<Result<ReadonlyArray<TableQuerySearchHeatByTable>, DomainError>> {
    try {
      const result = await this.db.transaction().execute(async (trx) => {
        await sql`
          SELECT set_config('statement_timeout', ${`${this.readStatementTimeoutMs}ms`}, true)
        `.execute(trx);
        return sql<{
          space_id: string | null;
          base_id: string | null;
          table_id: string;
          request_count: number | string;
          slow_count: number | string;
          timeout_count: number | string;
          db_error_count: number | string;
          total_duration_ms: number | string;
          max_duration_ms: number | string;
          window_start: Date | string;
          window_size_seconds: number | string;
          field_count: number | string | null;
          all_fields: boolean | null;
        }>`
          SELECT
            (array_agg(space_id ORDER BY writer_id)
              FILTER (WHERE space_id IS NOT NULL))[1] AS space_id,
            (array_agg(base_id ORDER BY writer_id)
              FILTER (WHERE base_id IS NOT NULL))[1] AS base_id,
            table_id,
            SUM(request_count) AS request_count,
            SUM(slow_count) AS slow_count,
            SUM(timeout_count) AS timeout_count,
            SUM(db_error_count) AS db_error_count,
            SUM(total_duration_ms) AS total_duration_ms,
            MAX(max_duration_ms) AS max_duration_ms,
            MAX(window_start) AS window_start,
            MAX(window_size_seconds) AS window_size_seconds,
            COALESCE(MAX((shape->'searchShape'->>'fieldCount')::int), 0) AS field_count,
            COALESCE(BOOL_OR((shape->'searchShape'->>'allFields')::boolean), false) AS all_fields
          FROM table_query_observation_shard
          WHERE window_start >= ${input.since}
            AND query_kind = 'search'
            AND (
              COALESCE((shape->'searchShape'->>'allFields')::boolean, false)
              OR COALESCE((shape->'searchShape'->>'fieldCount')::int, 0) >= ${input.wideSearchFields}
            )
          GROUP BY table_id
          HAVING SUM(slow_count) >= ${input.minSlowCount}
          ORDER BY SUM(slow_count) DESC, SUM(total_duration_ms) DESC
          LIMIT ${input.limit}
        `.execute(trx);
      });
      return ok(
        result.rows.flatMap((row) => {
          const baseId = row.base_id;
          if (!baseId) return [];
          const requestCount = Number(row.request_count);
          const slowCount = Number(row.slow_count);
          const timeoutCount = Number(row.timeout_count);
          const windowSizeSeconds = Number(row.window_size_seconds);
          if (!Number.isFinite(requestCount) || requestCount < 1) return [];
          if (!Number.isFinite(windowSizeSeconds) || windowSizeSeconds < 1) return [];
          if (slowCount > requestCount || timeoutCount > requestCount) return [];
          return [
            {
              ...(row.space_id ? { spaceId: row.space_id } : {}),
              baseId,
              tableId: row.table_id,
              requestCount,
              slowCount,
              timeoutCount,
              dbErrorCount: Number(row.db_error_count),
              totalDurationMs: Number(row.total_duration_ms),
              maxDurationMs: Number(row.max_duration_ms),
              windowStart: new Date(row.window_start),
              windowSizeSeconds,
              fieldCount: Number(row.field_count ?? 0),
              allFields: Boolean(row.all_fields),
            },
          ];
        })
      );
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to read table query search heat'));
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

export class PostgresTableQueryDecisionLogRepository {
  constructor(private readonly db: Kysely<TableQueryOpsDatabase>) {}

  async save(
    _context: IExecutionContext,
    entry: TableQueryDecisionLogEntry
  ): Promise<Result<TableQueryDecisionLogEntry, DomainError>> {
    const snapshot = entry.snapshot();
    const updateValues = {
      outcome: snapshot.outcome,
      reason_codes: toJsonb(snapshot.reasonCodes),
      cooldown_until: snapshot.cooldownUntil ?? null,
      last_modified_time: snapshot.lastModifiedTime ?? new Date(),
    };
    try {
      const row = await this.db
        .insertInto('table_query_decision_log')
        .values({
          id: snapshot.id,
          base_id: snapshot.baseId,
          table_id: snapshot.tableId,
          scope_key: snapshot.scopeKey,
          action: snapshot.action,
          actor: snapshot.actor,
          outcome: snapshot.outcome,
          reason_codes: toJsonb(snapshot.reasonCodes),
          recommendation_id: snapshot.recommendationId ?? null,
          would_auto_accept: snapshot.wouldAutoAccept,
          cooldown_until: snapshot.cooldownUntil ?? null,
          decided_at: snapshot.decidedAt,
          last_modified_time: snapshot.lastModifiedTime ?? null,
        })
        .onConflict((oc) => oc.column('id').doUpdateSet(updateValues))
        .returningAll()
        .executeTakeFirstOrThrow();
      return rowToDecisionLogEntry(row);
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to save table query decision log entry'));
    }
  }

  async findRecentByScope(
    _context: IExecutionContext,
    input: { readonly tableId: string; readonly scopeKey: string; readonly limit: number }
  ): Promise<Result<ReadonlyArray<TableQueryDecisionLogEntry>, DomainError>> {
    try {
      const rows = await this.db
        .selectFrom('table_query_decision_log')
        .selectAll()
        .where('table_id', '=', input.tableId)
        .where('scope_key', '=', input.scopeKey)
        .orderBy('decided_at', 'desc')
        .limit(input.limit)
        .execute();
      const entries: TableQueryDecisionLogEntry[] = [];
      for (const row of rows) {
        const entry = rowToDecisionLogEntry(row);
        if (entry.isErr()) return err(entry.error);
        entries.push(entry.value);
      }
      return ok(entries);
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to load table query decision log entries'));
    }
  }

  async findLatestByRecommendation(
    _context: IExecutionContext,
    input: { readonly recommendationId: string }
  ): Promise<Result<TableQueryDecisionLogEntry | undefined, DomainError>> {
    try {
      const row = await this.db
        .selectFrom('table_query_decision_log')
        .selectAll()
        .where('recommendation_id', '=', input.recommendationId)
        .orderBy('decided_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      if (!row) return ok(undefined);
      return rowToDecisionLogEntry(row);
    } catch (error) {
      return err(
        toInfrastructureError(error, 'Failed to load latest table query decision log entry')
      );
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

  async saveIfAbsent(
    _context: IExecutionContext,
    task: TableQueryRemediationTask
  ): Promise<Result<boolean, DomainError>> {
    const snapshot = task.snapshot();
    try {
      const result = await this.db
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
        .onConflict((oc) => oc.column('id').doNothing())
        .executeTakeFirst();
      return ok(Number(result.numInsertedOrUpdatedRows ?? 0) === 1);
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
      readonly allowManualIndexExecution: boolean;
      readonly allowPolicyIndexExecution: boolean;
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
          WHERE status IN ('queued', 'failed')
            AND kind = ANY(${input.allowedKinds})
            AND (
              ${input.allowManualIndexExecution}
              OR (
                ${input.allowPolicyIndexExecution}
                AND EXISTS (
                  SELECT 1
                  FROM table_query_decision_log AS decision
                  WHERE decision.recommendation_id = table_query_remediation_task.recommendation_id
                    AND decision.actor = 'system_policy'
                    AND decision.action = 'auto_accept'
                    AND decision.outcome = 'pending'
                )
              )
              OR payload ->> 'trigger' IN ('schema_change', 'reclaim')
            )
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
  row: TableQueryObservationRow
): Result<TableQueryObservationWindow, DomainError> => {
  const shape = TableQueryShape.create(row.shape);
  if (shape.isErr()) return err(shape.error);
  return TableQueryObservationWindow.create({
    spaceId: row.space_id ?? undefined,
    baseId: row.base_id,
    tableId: row.table_id,
    windowStart: row.window_start,
    windowSizeSeconds: Number(row.window_size_seconds),
    shapeHash: row.shape_hash,
    shape: shape.value,
    requestCount: Number(row.request_count),
    slowCount: Number(row.slow_count),
    timeoutCount: Number(row.timeout_count),
    dbErrorCount: Number(row.db_error_count),
    totalDurationMs: Number(row.total_duration_ms),
    maxDurationMs: Number(row.max_duration_ms),
    totalDbDurationMs:
      row.total_db_duration_ms === null ? undefined : Number(row.total_db_duration_ms),
    maxDbDurationMs: row.max_db_duration_ms === null ? undefined : Number(row.max_db_duration_ms),
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

const rowToDecisionLogEntry = (
  row: TableQueryOpsDatabase['table_query_decision_log']
): Result<TableQueryDecisionLogEntry, DomainError> =>
  TableQueryDecisionLogEntry.rehydrate({
    id: row.id,
    baseId: row.base_id,
    tableId: row.table_id,
    scopeKey: row.scope_key,
    action: row.action as never,
    actor: row.actor as never,
    outcome: row.outcome as never,
    reasonCodes: row.reason_codes as never,
    recommendationId: row.recommendation_id ?? undefined,
    wouldAutoAccept: row.would_auto_accept,
    cooldownUntil: row.cooldown_until ?? undefined,
    decidedAt: row.decided_at,
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
