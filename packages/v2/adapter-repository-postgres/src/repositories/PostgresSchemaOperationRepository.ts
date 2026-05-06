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
  payload: unknown | null;
  result: unknown | null;
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

@injectable()
export class PostgresSchemaOperationRepository implements core.ISchemaOperationRepository {
  constructor(
    @inject(v2PostgresStateTokens.db)
    private readonly db: Kysely<V1TeableDatabase>
  ) {}

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

    try {
      const result = await sql<SchemaOperationRow>`
        WITH candidate AS (
          SELECT "id"
          FROM "schema_operation"
          WHERE (
            ("status" IN ('pending', 'error') AND "next_run_at" <= ${now})
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
