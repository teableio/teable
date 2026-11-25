import { resolvePostgresDbOrTx } from '@teable/v2-adapter-db-postgres-shared';
import * as core from '@teable/v2-core';
import { domainError, type DomainError } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2PostgresStateTokens } from '../di/tokens';

type SchemaOperationRow = {
  id: string;
  type: string;
  status: string;
  phase: string;
  resource_type: string;
  resource_id: string;
  base_id: string | null;
  table_id: string | null;
  idempotency_key: string;
  payload: unknown;
  result: unknown;
  attempts: number;
  max_attempts: number;
  next_run_at: Date;
  locked_at: Date | null;
  locked_by: string | null;
  last_error: string | null;
  created_time: Date;
  created_by: string;
  last_modified_time: Date | null;
  last_modified_by: string | null;
};

const defaultListLimit = 100;
const maxListLimit = 500;

const jsonbValue = (value: unknown): ReturnType<typeof sql> => {
  if (value === undefined) {
    return sql`NULL`;
  }
  return sql`${JSON.stringify(value)}::jsonb`;
};

const mapRow = (row: SchemaOperationRow): core.SchemaOperationRecord => ({
  id: row.id,
  type: row.type,
  status: row.status as core.SchemaOperationStatus,
  phase: row.phase,
  target: {
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    ...(row.base_id ? { baseId: row.base_id } : {}),
    ...(row.table_id ? { tableId: row.table_id } : {}),
  },
  idempotencyKey: row.idempotency_key,
  payload: row.payload ?? undefined,
  result: row.result ?? undefined,
  attempts: row.attempts,
  maxAttempts: row.max_attempts,
  nextRunAt: row.next_run_at,
  lockedAt: row.locked_at,
  lockedBy: row.locked_by,
  lastError: row.last_error,
  createdTime: row.created_time,
  createdBy: row.created_by,
  lastModifiedTime: row.last_modified_time,
  lastModifiedBy: row.last_modified_by,
});

const clampLimit = (value: number | undefined): number => {
  if (!value || !Number.isFinite(value)) return defaultListLimit;
  return Math.min(maxListLimit, Math.max(1, Math.floor(value)));
};

const clampOffset = (value: number | undefined): number => {
  if (!value || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
};

const inFilter = (column: string, values: ReadonlyArray<string> | undefined) =>
  values?.length
    ? sql`${sql.ref(column)} IN (${sql.join(values.map((value) => sql`${value}`))})`
    : undefined;

const selectorWhere = (
  selector: core.SchemaOperationSelector
): Result<ReturnType<typeof sql>, DomainError> => {
  if ('id' in selector && selector.id) {
    return ok(sql`"id" = ${selector.id}`);
  }
  if ('idempotencyKey' in selector && selector.idempotencyKey) {
    return ok(sql`"idempotency_key" = ${selector.idempotencyKey}`);
  }
  return err(
    domainError.validation({
      code: 'schema_operation.selector_invalid',
      message: 'Schema operation selector must include id or idempotencyKey',
    })
  );
};

const listWhere = (input: core.SchemaOperationListInput = {}) => {
  const filters = [
    sql`TRUE`,
    inFilter('status', input.statuses),
    inFilter('type', input.types),
    inFilter('base_id', input.baseIds),
    inFilter('table_id', input.tableIds),
    inFilter('resource_id', input.resourceIds),
  ].filter((filter): filter is ReturnType<typeof sql> => Boolean(filter));

  return sql.join(filters, sql` AND `);
};

// Binding timestamps are an existing storage epoch: even an A→B→A cutover
// invalidates a previously enqueued operation. No credentials enter the payload.
const actorTargetQuery = (baseId: string, tableId: string) => sql<{
  base_id: string;
  table_id: string;
  db_table_name: string;
  version: number;
  connection_id: string | null;
  internal_schema: string | null;
  storage_epoch: string;
  actor_collision: boolean;
}>`
  SELECT t.base_id, t.id AS table_id, t.db_table_name, t.version,
    CASE WHEN s.mode = 'byodb' THEN s.data_db_connection_id ELSE NULL END AS connection_id,
    CASE WHEN s.mode = 'byodb' THEN c.internal_schema ELSE NULL END AS internal_schema,
    md5(jsonb_build_array(b.space_id, s.id, s.mode, s.state, s.last_modified_time,
      c.id, c.url_fingerprint, c.internal_schema, c.status, c.last_modified_time)::text) AS storage_epoch,
    EXISTS (SELECT 1 FROM field f WHERE f.table_id = t.id AND f.deleted_time IS NULL
      AND f.db_field_name IN ('__created_by_actor_type', '__created_by_actor_id',
        '__last_modified_by_actor_type', '__last_modified_by_actor_id')) AS actor_collision
  FROM table_meta t JOIN base b ON b.id = t.base_id
  LEFT JOIN space_data_db_binding s ON s.space_id = b.space_id
  LEFT JOIN data_db_connection c ON c.id = s.data_db_connection_id
  WHERE t.id = ${tableId} AND t.base_id = ${baseId}
    AND t.deleted_time IS NULL AND b.deleted_time IS NULL
    AND t.provision_state = 'ready' AND b.provision_state = 'ready'
    AND (s.id IS NULL OR s.state = 'ready')
    AND (s.mode IS DISTINCT FROM 'byodb' OR c.status = 'ready')
`;

const actorClaimWhere = (operation: core.SchemaOperationRecord) => sql`
  "id" = ${operation.id} AND "idempotency_key" = ${operation.idempotencyKey}
  AND "type" = 'table.actor_columns.enable' AND "status" = 'running'
  AND "locked_by" = ${operation.lockedBy ?? null}
  AND "locked_at" = ${operation.lockedAt ?? null}
`;

const actorFenceLost = () =>
  domainError.conflict({
    code: 'actor_columns.fence_lost',
    message: 'Record attribution operation no longer owns the table schema lease or target',
  });

@injectable()
export class PostgresSchemaOperationRepository implements core.ISchemaOperationRepository {
  constructor(
    @inject(v2PostgresStateTokens.db)
    private readonly db: Kysely<V1TeableDatabase>
  ) {}

  async getActorColumnsTarget(
    context: core.IExecutionContext,
    baseId: string,
    tableId: string,
    runtimeRouteKey: string
  ): Promise<Result<core.ActorColumnsTarget, DomainError>> {
    try {
      const result = await actorTargetQuery(baseId, tableId).execute(
        resolvePostgresDbOrTx(this.db, context, 'meta')
      );
      const row = result.rows[0];
      if (!row) return err(domainError.notFound({ message: 'Table is unavailable' }));
      if (row.actor_collision)
        return err(
          domainError.conflict({
            code: 'actor_columns.business_collision',
            message: 'A business field uses a reserved record attribution column',
          })
        );
      return ok({
        baseId: row.base_id,
        tableId: row.table_id,
        dbTableName: row.db_table_name,
        connectionId: row.connection_id,
        internalSchema: row.internal_schema,
        storageEpoch: row.storage_epoch,
        tableVersion: row.version,
        runtimeRouteKey,
      });
    } catch {
      return err(
        domainError.infrastructure({
          code: 'actor_columns.target_unavailable',
          message: 'Record attribution target is unavailable',
        })
      );
    }
  }

  async enqueueActorColumns(
    context: core.IExecutionContext,
    target: core.ActorColumnsTarget
  ): Promise<Result<core.SchemaOperationRecord, DomainError>> {
    const db = resolvePostgresDbOrTx(this.db, context, 'meta');
    const now = new Date();
    try {
      const result = await sql<SchemaOperationRow>`
        WITH current_target AS MATERIALIZED (${actorTargetQuery(target.baseId, target.tableId)}),
        eligible AS MATERIALIZED (
          SELECT t.id FROM table_meta t JOIN current_target r ON r.table_id = t.id
          WHERE t.actor_storage_version = 0 AND t.version = ${target.tableVersion}
            AND t.base_id = ${target.baseId} AND t.db_table_name = ${target.dbTableName}
            AND t.deleted_time IS NULL AND t.provision_state = 'ready'
            AND r.storage_epoch = ${target.storageEpoch} AND NOT r.actor_collision
            AND r.connection_id IS NOT DISTINCT FROM ${target.connectionId}
            AND r.internal_schema IS NOT DISTINCT FROM ${target.internalSchema}
          FOR UPDATE OF t
        )
        INSERT INTO schema_operation (id, type, status, phase, resource_type, resource_id,
          base_id, table_id, idempotency_key, payload, attempts, max_attempts, next_run_at,
          created_time, created_by, last_modified_time, last_modified_by)
        SELECT ${core.generatePrefixedId('sgo', 16)}, 'table.actor_columns.enable', 'pending',
          'pending', 'table', ${target.tableId}, ${target.baseId}, ${target.tableId},
          ${`table:${target.tableId}:actor_columns:v1`}, ${jsonbValue(target)}, 0, 8, ${now},
          ${now}, ${context.actorId.toString()}, ${now}, ${context.actorId.toString()}
        FROM eligible WHERE TRUE
        ON CONFLICT (idempotency_key) DO UPDATE SET
          status = CASE WHEN schema_operation.status IN ('error', 'dead', 'ready') THEN 'pending' ELSE schema_operation.status END,
          phase = CASE WHEN schema_operation.status IN ('error', 'dead', 'ready') THEN 'pending' ELSE schema_operation.phase END,
          payload = CASE WHEN schema_operation.status IN ('error', 'dead', 'ready') THEN EXCLUDED.payload ELSE schema_operation.payload END,
          result = CASE WHEN schema_operation.status IN ('error', 'dead', 'ready') THEN NULL ELSE schema_operation.result END,
          base_id = CASE WHEN schema_operation.status IN ('error', 'dead', 'ready') THEN EXCLUDED.base_id ELSE schema_operation.base_id END,
          attempts = CASE WHEN schema_operation.status IN ('error', 'dead', 'ready') THEN 0 ELSE schema_operation.attempts END,
          next_run_at = CASE WHEN schema_operation.status IN ('error', 'dead', 'ready') THEN EXCLUDED.next_run_at ELSE schema_operation.next_run_at END,
          last_error = CASE WHEN schema_operation.status IN ('error', 'dead', 'ready') THEN NULL ELSE schema_operation.last_error END,
          locked_at = CASE WHEN schema_operation.status IN ('error', 'dead', 'ready') THEN NULL ELSE schema_operation.locked_at END,
          locked_by = CASE WHEN schema_operation.status IN ('error', 'dead', 'ready') THEN NULL ELSE schema_operation.locked_by END,
          last_modified_time = CASE WHEN schema_operation.status IN ('error', 'dead', 'ready') THEN EXCLUDED.last_modified_time ELSE schema_operation.last_modified_time END,
          last_modified_by = CASE WHEN schema_operation.status IN ('error', 'dead', 'ready') THEN EXCLUDED.last_modified_by ELSE schema_operation.last_modified_by END
        WHERE schema_operation.type = 'table.actor_columns.enable'
          AND schema_operation.table_id = EXCLUDED.table_id
          AND schema_operation.resource_type = 'table' AND schema_operation.resource_id = EXCLUDED.resource_id
        RETURNING *
      `.execute(db);
      if (!result.rows[0]) return err(actorFenceLost());
      return ok(mapRow(result.rows[0]));
    } catch {
      return err(
        domainError.infrastructure({
          code: 'actor_columns.enqueue_failed',
          message: 'Unable to enqueue record attribution enable',
        })
      );
    }
  }

  async completeActorColumns(
    context: core.IExecutionContext,
    input: core.ActorColumnsCompletionInput
  ): Promise<Result<core.SchemaOperationRecord, DomainError>> {
    const { operation, target, leaseFence } = input;
    if (!operation.lockedBy || !operation.lockedAt) return err(actorFenceLost());
    const db = resolvePostgresDbOrTx(this.db, context, 'meta');
    try {
      // One atomic statement: a stale owner cannot update the table OR settle the op.
      // pg_locks proves the exact table's exclusive xact advisory lock, not merely
      // that a backend with the same PID still exists after connection recycling.
      const result = await sql<SchemaOperationRow>`
        WITH owned AS MATERIALIZED (
          SELECT * FROM schema_operation WHERE ${actorClaimWhere(operation)}
            AND payload = ${jsonbValue(target)} FOR UPDATE
        ), current_target AS MATERIALIZED (${actorTargetQuery(target.baseId, target.tableId)}),
        published AS (
          UPDATE table_meta t SET actor_storage_version = 1, version = t.version + 1
          FROM current_target r, owned o
          WHERE t.id = r.table_id AND t.actor_storage_version = 0
            AND t.version = ${target.tableVersion} AND t.base_id = ${target.baseId}
            AND t.db_table_name = ${target.dbTableName} AND t.deleted_time IS NULL
            AND t.provision_state = 'ready'
            AND r.base_id = ${target.baseId} AND r.db_table_name = ${target.dbTableName}
            AND r.version = ${target.tableVersion}
            AND r.connection_id IS NOT DISTINCT FROM ${target.connectionId}
            AND r.internal_schema IS NOT DISTINCT FROM ${target.internalSchema}
            AND r.storage_epoch = ${target.storageEpoch}
            AND NOT r.actor_collision
            AND EXISTS (
              SELECT 1 FROM pg_stat_activity a JOIN pg_locks l ON l.pid = a.pid
              WHERE a.pid = ${leaseFence.backendPid}
                AND a.backend_xid::text = (( ${leaseFence.transactionId}::numeric % 4294967296)::bigint)::text
                AND a.state = 'idle in transaction' AND l.locktype = 'advisory'
                AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
                AND l.granted AND l.mode = 'ExclusiveLock' AND l.objsubid = 1
                AND l.classid::bigint = ((hashtextextended(${`teable.schema:table:${target.tableId}`}, 0) >> 32) & 4294967295)
                AND l.objid::bigint = (hashtextextended(${`teable.schema:table:${target.tableId}`}, 0) & 4294967295)
            )
          RETURNING t.id
        )
        UPDATE schema_operation SET status = 'ready', phase = 'ready', last_error = NULL,
          locked_at = NULL, locked_by = NULL, last_modified_time = now(),
          last_modified_by = ${context.actorId.toString()},
          result = ${jsonbValue({
            baseId: target.baseId,
            tableId: target.tableId,
            oldVersion: target.tableVersion,
            newVersion: target.tableVersion + 1,
            notificationDelivered: false,
          })}
        WHERE ${actorClaimWhere(operation)} AND EXISTS (SELECT 1 FROM published)
        RETURNING *
      `.execute(db);
      return result.rows[0] ? ok(mapRow(result.rows[0])) : err(actorFenceLost());
    } catch {
      return err(
        domainError.infrastructure({
          code: 'actor_columns.publish_failed',
          message: 'Unable to publish record attribution capability',
        })
      );
    }
  }

  async markActorColumnsNotified(
    context: core.IExecutionContext,
    operation: core.SchemaOperationRecord
  ): Promise<Result<void, DomainError>> {
    const result = operation.result as Record<string, unknown> | undefined;
    if (!result || typeof result.oldVersion !== 'number' || typeof result.newVersion !== 'number') {
      return err(actorFenceLost());
    }
    try {
      const updated = await sql<{ id: string }>`
        UPDATE schema_operation SET result = result || '{"notificationDelivered":true}'::jsonb
        WHERE id = ${operation.id} AND type = 'table.actor_columns.enable' AND status = 'ready'
          AND base_id = ${operation.target.baseId ?? null} AND table_id = ${operation.target.tableId ?? null}
          AND result->>'oldVersion' = ${String(result.oldVersion)}
          AND result->>'newVersion' = ${String(result.newVersion)}
        RETURNING id
      `.execute(resolvePostgresDbOrTx(this.db, context, 'meta'));
      return updated.rows[0] ? ok(undefined) : err(actorFenceLost());
    } catch {
      return err(
        domainError.infrastructure({
          message: 'Unable to acknowledge record attribution metadata notification',
        })
      );
    }
  }

  async failActorColumns(
    context: core.IExecutionContext,
    operation: core.SchemaOperationRecord,
    input: core.SchemaOperationAdvanceInput
  ): Promise<Result<core.SchemaOperationRecord, DomainError>> {
    try {
      const result = await sql<SchemaOperationRow>`
        UPDATE schema_operation SET status = ${input.status}, phase = 'error',
          attempts = attempts + 1, next_run_at = ${input.nextRunAt ?? new Date()},
          last_error = ${input.lastError ?? 'Record attribution enable failed'},
          result = ${jsonbValue(input.result)},
          locked_at = NULL, locked_by = NULL, last_modified_time = now(),
          last_modified_by = ${context.actorId.toString()}
        WHERE ${actorClaimWhere(operation)} RETURNING *
      `.execute(resolvePostgresDbOrTx(this.db, context, 'meta'));
      return result.rows[0] ? ok(mapRow(result.rows[0])) : err(actorFenceLost());
    } catch {
      return err(
        domainError.infrastructure({ message: 'Unable to settle record attribution failure' })
      );
    }
  }

  @core.TraceSpan()
  async upsert(
    context: core.IExecutionContext,
    input: core.SchemaOperationUpsertInput
  ): Promise<Result<core.SchemaOperationRecord, DomainError>> {
    const now = new Date();
    const actorId = context.actorId.toString();
    const db = resolvePostgresDbOrTx(this.db, context, 'meta');

    try {
      const result = await sql<SchemaOperationRow>`
        INSERT INTO "schema_operation" (
          "id",
          "type",
          "status",
          "phase",
          "resource_type",
          "resource_id",
          "base_id",
          "table_id",
          "idempotency_key",
          "payload",
          "result",
          "attempts",
          "max_attempts",
          "next_run_at",
          "last_error",
          "created_time",
          "created_by",
          "last_modified_time",
          "last_modified_by"
        )
        VALUES (
          ${input.id ?? core.generatePrefixedId('sgo', 16)},
          ${input.type},
          ${input.status},
          ${input.phase},
          ${input.target.resourceType},
          ${input.target.resourceId},
          ${input.target.baseId ?? null},
          ${input.target.tableId ?? null},
          ${input.idempotencyKey},
          ${jsonbValue(input.payload)},
          ${jsonbValue(input.result)},
          ${input.status === 'error' || input.status === 'dead' ? 1 : 0},
          ${input.maxAttempts ?? 8},
          ${input.nextRunAt ?? now},
          ${input.lastError ?? null},
          ${now},
          ${actorId},
          ${now},
          ${actorId}
        )
        ON CONFLICT ("idempotency_key")
        DO UPDATE SET
          "type" = EXCLUDED."type",
          "status" = EXCLUDED."status",
          "phase" = EXCLUDED."phase",
          "resource_type" = EXCLUDED."resource_type",
          "resource_id" = EXCLUDED."resource_id",
          "base_id" = EXCLUDED."base_id",
          "table_id" = EXCLUDED."table_id",
          "payload" = COALESCE(EXCLUDED."payload", "schema_operation"."payload"),
          "result" = COALESCE(EXCLUDED."result", "schema_operation"."result"),
          "attempts" = CASE
            WHEN EXCLUDED."status" IN ('error', 'dead') THEN "schema_operation"."attempts" + 1
            ELSE "schema_operation"."attempts"
          END,
          "max_attempts" = EXCLUDED."max_attempts",
          "next_run_at" = EXCLUDED."next_run_at",
          "last_error" = EXCLUDED."last_error",
          "last_modified_time" = EXCLUDED."last_modified_time",
          "last_modified_by" = EXCLUDED."last_modified_by"
        RETURNING *
      `.execute(db);
      const row = result.rows[0];
      if (!row) {
        return err(domainError.unexpected({ message: 'Schema operation upsert returned no row' }));
      }
      return ok(mapRow(row));
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to upsert schema operation: ${describeError(error)}`,
        })
      );
    }
  }

  @core.TraceSpan()
  async advance(
    context: core.IExecutionContext,
    idempotencyKey: string,
    input: core.SchemaOperationAdvanceInput
  ): Promise<Result<core.SchemaOperationRecord, DomainError>> {
    const now = new Date();
    const actorId = context.actorId.toString();
    const db = resolvePostgresDbOrTx(this.db, context, 'meta');

    try {
      const result = await sql<SchemaOperationRow>`
        UPDATE "schema_operation"
        SET
          "status" = ${input.status},
          "phase" = ${input.phase},
          "payload" = COALESCE(${jsonbValue(input.payload)}, "payload"),
          "result" = COALESCE(${jsonbValue(input.result)}, "result"),
          "attempts" = CASE
            WHEN ${input.status} IN ('error', 'dead') THEN "attempts" + 1
            ELSE "attempts"
          END,
          "next_run_at" = ${input.nextRunAt ?? now},
          "locked_at" = CASE
            WHEN ${input.status} = 'running' THEN "locked_at"
            ELSE NULL
          END,
          "locked_by" = CASE
            WHEN ${input.status} = 'running' THEN "locked_by"
            ELSE NULL
          END,
          "last_error" = ${input.lastError ?? null},
          "last_modified_time" = ${now},
          "last_modified_by" = ${actorId}
        WHERE "idempotency_key" = ${idempotencyKey}
        RETURNING *
      `.execute(db);
      const row = result.rows[0];
      if (!row) {
        return err(
          domainError.notFound({
            code: 'schema_operation.not_found',
            message: 'Schema operation not found',
          })
        );
      }
      return ok(mapRow(row));
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to advance schema operation: ${describeError(error)}`,
        })
      );
    }
  }

  @core.TraceSpan()
  async claimNextRunnable(
    context: core.IExecutionContext,
    input: core.SchemaOperationClaimInput
  ): Promise<Result<core.SchemaOperationRecord | undefined, DomainError>> {
    if (input.types?.length === 0) {
      return ok(undefined);
    }

    const now = input.now ?? new Date();
    const staleRunningBefore = input.staleRunningBefore ?? new Date(now.getTime() - 5 * 60 * 1000);
    const actorId = context.actorId.toString();
    const db = resolvePostgresDbOrTx(this.db, context, 'meta');
    const typeFilter = input.types?.length
      ? sql`AND "type" IN (${sql.join(input.types.map((type) => sql`${type}`))})`
      : sql``;
    // CSV/table.import rows stay pending while the request is still writing
    // records. They are not automatically repairable, so claiming them after
    // the stale window would mark a live import dead. DotTea structure imports
    // remain eligible.

    try {
      const result = await sql<SchemaOperationRow>`
        WITH candidate AS (
          SELECT "id"
          FROM "schema_operation"
          WHERE (
            ("status" = 'error' AND "next_run_at" <= ${now})
            OR (
              "status" = 'pending'
              AND "next_run_at" <= ${now}
              AND (
                "type" = 'table.actor_columns.enable'
                OR "phase" = 'waiting_for_lock'
                OR "last_modified_time" <= ${staleRunningBefore}
              )
              AND NOT (
                "type" = 'table.import'
                AND COALESCE("payload"->>'source', '') <> 'dottea'
              )
            )
            OR (
              "status" = 'running'
              AND "locked_at" IS NOT NULL
              AND "locked_at" <= ${staleRunningBefore}
            )
          )
          ${typeFilter}
          ORDER BY "next_run_at" ASC, "created_time" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "schema_operation"
        SET
          "status" = 'running',
          "phase" = ${input.phase ?? 'running'},
          "locked_at" = ${now},
          "locked_by" = ${input.lockedBy},
          "last_modified_time" = ${now},
          "last_modified_by" = ${actorId}
        FROM candidate
        WHERE "schema_operation"."id" = candidate."id"
        RETURNING "schema_operation".*
      `.execute(db);

      const row = result.rows[0];
      return ok(row ? mapRow(row) : undefined);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to claim schema operation: ${describeError(error)}`,
        })
      );
    }
  }

  @core.TraceSpan()
  async findOpenByTarget(
    context: core.IExecutionContext,
    target: core.SchemaOperationTarget
  ): Promise<Result<ReadonlyArray<core.SchemaOperationRecord>, DomainError>> {
    const db = resolvePostgresDbOrTx(this.db, context, 'meta');

    try {
      const rows = await db
        .selectFrom('schema_operation')
        .selectAll()
        .where('resource_type', '=', target.resourceType)
        .where('resource_id', '=', target.resourceId)
        .where('status', 'in', ['pending', 'running', 'error'])
        .orderBy('last_modified_time', 'desc')
        .execute();
      return ok(rows.map((row) => mapRow(row as SchemaOperationRow)));
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to find schema operations: ${describeError(error)}`,
        })
      );
    }
  }

  @core.TraceSpan()
  async list(
    context: core.IExecutionContext,
    input: core.SchemaOperationListInput = {}
  ): Promise<Result<core.SchemaOperationListResult, DomainError>> {
    const db = resolvePostgresDbOrTx(this.db, context, 'meta');
    const limit = clampLimit(input.limit);
    const offset = clampOffset(input.offset);
    const where = listWhere(input);

    try {
      const [rowsResult, totalResult] = await Promise.all([
        sql<SchemaOperationRow>`
          SELECT *
          FROM "schema_operation"
          WHERE ${where}
          ORDER BY COALESCE("last_modified_time", "created_time") DESC, "created_time" DESC, "id" ASC
          LIMIT ${limit}
          OFFSET ${offset}
        `.execute(db),
        sql<{ count: number }>`
          SELECT COUNT(*)::int AS "count"
          FROM "schema_operation"
          WHERE ${where}
        `.execute(db),
      ]);

      return ok({
        items: rowsResult.rows.map(mapRow),
        total: totalResult.rows[0]?.count ?? 0,
      });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to list schema operations: ${describeError(error)}`,
        })
      );
    }
  }

  @core.TraceSpan()
  async manualRetry(
    context: core.IExecutionContext,
    input: core.SchemaOperationManualRetryInput
  ): Promise<Result<core.SchemaOperationRecord, DomainError>> {
    const where = selectorWhere(input.selector);
    if (where.isErr()) return err(where.error);

    const now = input.now ?? new Date();
    const actorId = context.actorId.toString();
    const db = resolvePostgresDbOrTx(this.db, context, 'meta');
    const resetAttempts = input.resetAttempts ?? true;

    try {
      const result = await sql<SchemaOperationRow>`
        UPDATE "schema_operation"
        SET
          "status" = 'error',
          "phase" = 'error',
          "attempts" = CASE WHEN ${resetAttempts} THEN 0 ELSE "attempts" END,
          "next_run_at" = ${now},
          "locked_at" = NULL,
          "locked_by" = NULL,
          "last_error" = ${input.lastError ?? null},
          "last_modified_time" = ${now},
          "last_modified_by" = ${actorId}
        WHERE ${where.value}
        RETURNING *
      `.execute(db);

      const row = result.rows[0];
      if (!row) {
        return err(
          domainError.notFound({
            code: 'schema_operation.not_found',
            message: 'Schema operation not found',
          })
        );
      }
      return ok(mapRow(row));
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to retry schema operation: ${describeError(error)}`,
        })
      );
    }
  }

  @core.TraceSpan()
  async markDead(
    context: core.IExecutionContext,
    input: core.SchemaOperationMarkDeadInput
  ): Promise<Result<core.SchemaOperationRecord, DomainError>> {
    const where = selectorWhere(input.selector);
    if (where.isErr()) return err(where.error);

    const now = input.now ?? new Date();
    const actorId = context.actorId.toString();
    const db = resolvePostgresDbOrTx(this.db, context, 'meta');
    const reason = input.reason ?? 'Marked dead manually';

    try {
      const result = await sql<SchemaOperationRow>`
        UPDATE "schema_operation"
        SET
          "status" = 'dead',
          "phase" = 'error',
          "next_run_at" = ${now},
          "locked_at" = NULL,
          "locked_by" = NULL,
          "last_error" = ${reason},
          "last_modified_time" = ${now},
          "last_modified_by" = ${actorId}
        WHERE ${where.value}
        RETURNING *
      `.execute(db);

      const row = result.rows[0];
      if (!row) {
        return err(
          domainError.notFound({
            code: 'schema_operation.not_found',
            message: 'Schema operation not found',
          })
        );
      }
      return ok(mapRow(row));
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to mark schema operation dead: ${describeError(error)}`,
        })
      );
    }
  }
}

const describeError = (error: unknown): string => {
  if (core.isDomainError(error)) return error.message;
  if (error instanceof Error) {
    return error.message ? `${error.name}: ${error.message}` : error.name;
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
};
