import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ensureTableQueryObservationSchema,
  ensureTableQueryOpsSchema,
  type TableQueryObservationDatabase,
  type TableQueryOpsDatabase,
} from './schema';

const runPostgresAcceptance = process.env.TEABLE_V2_RUN_OBSERVATION_SCHEMA_PG_INTEGRATION === '1';
const testDatabaseUrl = process.env.PRISMA_DATABASE_URL;
if (runPostgresAcceptance && !testDatabaseUrl) {
  throw new Error('TEABLE_V2_RUN_OBSERVATION_SCHEMA_PG_INTEGRATION=1 requires PRISMA_DATABASE_URL');
}
const describeWithPostgres = runPostgresAcceptance ? describe : describe.skip;

describeWithPostgres('ensureTableQueryObservationSchema lock timeout', () => {
  let locker: Kysely<TableQueryObservationDatabase>;
  let contender: Kysely<TableQueryObservationDatabase>;

  beforeAll(async () => {
    locker = await createV2PostgresDb<TableQueryObservationDatabase>({
      pg: { connectionString: testDatabaseUrl!, pool: { max: 1, allowExitOnIdle: true } },
    });
    contender = await createV2PostgresDb<TableQueryObservationDatabase>({
      pg: { connectionString: testDatabaseUrl!, pool: { max: 1, allowExitOnIdle: true } },
    });
    await ensureTableQueryObservationSchema(locker);
  });

  afterAll(async () => {
    await Promise.all([locker?.destroy(), contender?.destroy()]);
  });

  it('creates the writer-sharded primary key and retention index', async () => {
    const result = await sql<{ indexname: string }>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'table_query_observation_shard'
      ORDER BY indexname
    `.execute(locker);

    expect(result.rows.map((row) => row.indexname)).toEqual([
      'table_query_observation_shard_base_start_idx',
      'table_query_observation_shard_pkey',
      'table_query_observation_shard_search_activity_idx',
      'table_query_observation_shard_table_start_idx',
      'table_query_observation_shard_window_start_idx',
    ]);
  });

  it('moves pre-shard windows into the legacy writer shard and drops the old table', async () => {
    const tableId = `tblObservationLegacy${process.pid}`;
    await sql`
      CREATE TABLE IF NOT EXISTS table_query_observation_window (
        id text PRIMARY KEY,
        space_id text,
        base_id text NOT NULL,
        table_id text NOT NULL,
        query_kind text NOT NULL,
        shape_hash text NOT NULL,
        window_start timestamptz NOT NULL,
        window_size_seconds integer NOT NULL,
        request_count integer NOT NULL,
        slow_count integer NOT NULL,
        timeout_count integer NOT NULL,
        db_error_count integer NOT NULL,
        total_duration_ms double precision NOT NULL,
        max_duration_ms double precision NOT NULL,
        total_db_duration_ms double precision,
        max_db_duration_ms double precision,
        shape jsonb NOT NULL,
        sql_diagnostics jsonb,
        created_time timestamptz NOT NULL DEFAULT now(),
        last_modified_time timestamptz
      )
    `.execute(locker);
    await sql`
      INSERT INTO table_query_observation_window (
        id, space_id, base_id, table_id, query_kind, shape_hash, window_start,
        window_size_seconds, request_count, slow_count, timeout_count, db_error_count,
        total_duration_ms, max_duration_ms, total_db_duration_ms, max_db_duration_ms,
        shape, sql_diagnostics
      ) VALUES (
        'legacy-window', 'spc-legacy', 'bse-legacy', ${tableId}, 'recordList', 'shape-legacy',
        '2026-06-01T00:00:00.000Z', 300, 7, 1, 0, 0, 70, 20, 50, 15,
        '{}'::jsonb, NULL
      )
    `.execute(locker);

    await ensureTableQueryObservationSchema(locker);

    const oldTable = await sql<{ name: string | null }>`
      SELECT to_regclass(format('%I.%I', current_schema(), 'table_query_observation_window'))::text AS name
    `.execute(locker);
    const migrated = await locker
      .selectFrom('table_query_observation_shard')
      .select(['writer_id', 'request_count', 'space_id'])
      .where('table_id', '=', tableId)
      .executeTakeFirstOrThrow();
    expect(oldTable.rows[0]?.name).toBeNull();
    expect(migrated).toEqual({ writer_id: 'legacy', request_count: 7, space_id: 'spc-legacy' });

    await sql`DELETE FROM table_query_observation_shard WHERE table_id = ${tableId}`.execute(
      locker
    );
  });

  it('upgrades an existing task table without changing its payload, receipt or owner', async () => {
    const schema = `query_ops_upgrade_${process.pid}`;
    const journal = {
      version: 1,
      kind: 'search_generation',
      phase: 'column_ready',
      indexName: 'owned_generation',
    };
    await (locker as unknown as Kysely<TableQueryOpsDatabase>).connection().execute(async (db) => {
      await sql`BEGIN`.execute(db);
      try {
        await db.schema.createSchema(schema).execute();
        await sql`SELECT set_config('search_path', ${schema}, true)`.execute(db);
        await sql`CREATE TABLE table_query_remediation_task (
          id text PRIMARY KEY, recommendation_id text, base_id text NOT NULL, table_id text NOT NULL,
          kind text NOT NULL, status text NOT NULL, payload jsonb NOT NULL, result jsonb,
          attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 3,
          locked_at timestamptz, locked_by text, last_error text,
          created_time timestamptz NOT NULL DEFAULT now(), last_modified_time timestamptz
        )`.execute(db);
        await sql`INSERT INTO table_query_remediation_task
          (id, base_id, table_id, kind, status, payload, result, attempts, locked_at, locked_by)
          VALUES ('legacy-task', 'base', 'table', 'create_search_access_path', 'running',
            '{"frozen":"target"}'::jsonb, '{"receipt":"existing"}'::jsonb, 2,
            '2026-11-01T00:00:00Z', 'existing-worker')`.execute(db);
        const before = await db
          .selectFrom('table_query_remediation_task')
          .selectAll()
          .executeTakeFirstOrThrow();
        await ensureTableQueryOpsSchema(db);
        const upgraded = await db
          .selectFrom('table_query_remediation_task')
          .selectAll()
          .executeTakeFirstOrThrow();
        expect(upgraded).toEqual({ ...before, execution_state: null });
        await db
          .updateTable('table_query_remediation_task')
          .set({ execution_state: JSON.stringify(journal) })
          .where('id', '=', 'legacy-task')
          .execute();
        await ensureTableQueryOpsSchema(db);
        const repeated = await db
          .selectFrom('table_query_remediation_task')
          .selectAll()
          .executeTakeFirstOrThrow();
        expect(repeated).toEqual({ ...before, execution_state: journal });
      } finally {
        await sql`ROLLBACK`.execute(db);
      }
    });
  });

  it('does not queue task-table DDL when the journal column already exists', async () => {
    const opsLocker = locker as unknown as Kysely<TableQueryOpsDatabase>;
    const opsContender = contender as unknown as Kysely<TableQueryOpsDatabase>;
    await ensureTableQueryOpsSchema(opsLocker);
    const { promise: locked, resolve: markLocked } = Promise.withResolvers<void>();
    const { promise: released, resolve: releaseLock } = Promise.withResolvers<void>();
    const lock = opsLocker.transaction().execute(async (trx) => {
      await sql`LOCK TABLE table_query_remediation_task IN ACCESS SHARE MODE`.execute(trx);
      markLocked();
      await released;
    });
    await locked;

    try {
      const ensure = ensureTableQueryOpsSchema(opsContender);
      const { promise: expired, resolve: expire } = Promise.withResolvers<'timed_out'>();
      const timer = setTimeout(() => expire('timed_out'), 1_000);
      const outcome = await Promise.race([ensure.then(() => 'completed' as const), expired]);
      clearTimeout(timer);
      releaseLock();
      await lock;
      await ensure;
      expect(outcome).toBe('completed');
    } finally {
      releaseLock();
      await lock.catch(() => undefined);
    }
  });

  it('fails fast instead of waiting behind observation DDL locks', async () => {
    let markLocked!: () => void;
    let releaseLock!: () => void;
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lock = locker.transaction().execute(async (trx) => {
      await sql`LOCK TABLE table_query_observation_shard IN ACCESS EXCLUSIVE MODE`.execute(trx);
      markLocked();
      await released;
    });
    await locked;

    try {
      await expect(
        ensureTableQueryObservationSchema(contender, {
          lockTimeoutMs: 50,
          statementTimeoutMs: 100,
        })
      ).rejects.toThrow();
    } finally {
      releaseLock();
      await lock;
    }
  });
});
