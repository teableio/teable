import {
  createV2PostgresDb,
  PostgresUnitOfWorkTransaction,
} from '@teable/v2-adapter-db-postgres-pg';
import type { IExecutionContext, ILogger } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { sql, type Kysely, type Transaction } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ComputedUpdatePauseRegistry } from './ComputedUpdatePauseRegistry';

/**
 * T8081: a nested computed checkout runs inside the caller's transaction, which
 * already holds the connection. Admission used to query the pool handle instead,
 * so a tenant pool capped at one connection (common for BYODB) waited on a
 * checkout its own caller was holding until connectionTimeoutMillis and failed.
 *
 * Run with:
 *   TEABLE_V2_RUN_PG_INTEGRATION=1 \
 *   pnpm --filter @teable/v2-adapter-table-repository-postgres exec vitest run \
 *     src/record/computed/pause/ComputedUpdatePauseRegistry.pg.integration.spec.ts
 */
const runIntegration = process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1';
const describePg = runIntegration ? describe : describe.skip;

const SPACE_ID = `spc${'s'.repeat(16)}`;
const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;

/** Short enough that a second checkout fails fast instead of hanging the suite. */
const SINGLE_CONNECTION_TIMEOUT_MS = 250;

const createLogger = (): ILogger => ({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  child: () => createLogger(),
  scope: () => createLogger(),
});

const bindTransaction = (trx: Transaction<V1TeableDatabase>): IExecutionContext =>
  ({
    transaction: new PostgresUnitOfWorkTransaction(trx, 'data'),
  }) as unknown as IExecutionContext;

describePg('ComputedUpdatePauseRegistry nested admission (Postgres)', () => {
  let stopPostgres: (() => Promise<unknown>) | undefined;
  let db: Kysely<V1TeableDatabase>;
  /** Independent pool for assertions that must not reuse the caller connection. */
  let observerDb: Kysely<V1TeableDatabase>;
  /** Two-connection pool: the smallest pool that can run two writes concurrently. */
  let concurrentDb: Kysely<V1TeableDatabase>;
  let registry: ComputedUpdatePauseRegistry;
  let concurrentRegistry: ComputedUpdatePauseRegistry;

  beforeAll(async () => {
    const container = await new PostgreSqlContainer(
      process.env.TEABLE_V2_TEST_PG_IMAGE ?? 'postgres:16-alpine'
    ).start();
    stopPostgres = () => container.stop();
    const databaseUrl = container.getConnectionUri();
    db = await createV2PostgresDb<V1TeableDatabase>({
      pg: {
        connectionString: databaseUrl,
        pool: { max: 1, connectionTimeoutMillis: SINGLE_CONNECTION_TIMEOUT_MS },
      },
    });
    observerDb = await createV2PostgresDb<V1TeableDatabase>({
      pg: { connectionString: databaseUrl, pool: { max: 1 } },
    });
    concurrentDb = await createV2PostgresDb<V1TeableDatabase>({
      pg: {
        connectionString: databaseUrl,
        pool: { max: 2, connectionTimeoutMillis: SINGLE_CONNECTION_TIMEOUT_MS },
      },
    });

    await db.schema
      .createTable('space')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('name', 'text')
      .execute();
    await db.schema
      .createTable('base')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('space_id', 'text', (col) => col.notNull())
      .addColumn('name', 'text')
      .execute();
    await db.schema
      .createTable('table_meta')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('base_id', 'text', (col) => col.notNull())
      .addColumn('name', 'text')
      .addColumn('deleted_time', 'timestamptz')
      .execute();
    await db.schema
      .createTable('computed_update_pause_scope')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('scope_type', 'text', (col) => col.notNull())
      .addColumn('scope_id', 'text', (col) => col.notNull())
      .addColumn('paused_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addColumn('paused_by', 'text')
      .addColumn('resume_at', 'timestamptz')
      .addColumn('reason', 'text')
      .addColumn('write_policy', 'text', (col) => col.notNull().defaultTo('allow_bounded'))
      .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addColumn('updated_by', 'text')
      .execute();
    await sql`
      CREATE UNIQUE INDEX "computed_update_pause_scope_scope_type_scope_id_key"
      ON "computed_update_pause_scope"("scope_type", "scope_id")
    `.execute(db);
    await db.schema
      .createTable('computed_update_outbox')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('base_id', 'text', (col) => col.notNull())
      .addColumn('seed_table_id', 'text', (col) => col.notNull())
      .addColumn('status', 'text', (col) => col.notNull())
      .addColumn('affected_table_ids', sql`text[]`, (col) =>
        col.notNull().defaultTo(sql`ARRAY[]::text[]`)
      )
      .addColumn('next_run_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .execute();

    await db.insertInto('space').values({ id: SPACE_ID, name: 'Space' }).execute();
    await db.insertInto('base').values({ id: BASE_ID, space_id: SPACE_ID, name: 'Base' }).execute();
    await db
      .insertInto('table_meta')
      .values({ id: TABLE_ID, base_id: BASE_ID, name: 'Table', deleted_time: null })
      .execute();

    registry = new ComputedUpdatePauseRegistry(db, createLogger());
    concurrentRegistry = new ComputedUpdatePauseRegistry(concurrentDb, createLogger());
  });

  afterAll(async () => {
    await concurrentDb?.destroy();
    await observerDb?.destroy();
    await db?.destroy();
    await stopPostgres?.();
  });

  beforeEach(async () => {
    await db.deleteFrom('computed_update_outbox').execute();
    await db.deleteFrom('computed_update_pause_scope').execute();
  });

  it('admits a nested checkout without a second connection when the pool is exhausted', async () => {
    const admitted = await db.transaction().execute(async (trx) => {
      return registry.admitComputedWrite(
        { tableId: TABLE_ID, baseId: BASE_ID },
        bindTransaction(trx)
      );
    });

    expect(admitted.isOk()).toBe(true);
  });

  it('keeps the backlog auto-release inside the caller transaction', async () => {
    const paused = await registry.pauseScope({
      scopeType: 'base',
      scopeId: BASE_ID,
      resumeAt: new Date(Date.now() + 30 * 60 * 1000),
      actor: 'ops',
      writePolicy: 'allow_bounded',
    });
    expect(paused.isOk()).toBe(true);

    for (const taskId of ['cuo-pending-1', 'cuo-pending-2']) {
      await db
        .insertInto('computed_update_outbox')
        .values({
          id: taskId,
          base_id: BASE_ID,
          seed_table_id: TABLE_ID,
          status: 'pending',
          affected_table_ids: [TABLE_ID],
          next_run_at: new Date(),
          updated_at: new Date(),
        })
        .execute();
    }

    const admitted = await db.transaction().execute(async (trx) => {
      const result = await registry.admitComputedWrite(
        { tableId: TABLE_ID, baseId: BASE_ID, backlogWatermark: 2 },
        bindTransaction(trx)
      );
      if (result.isErr()) return result;

      // The release belongs to the caller transaction: a peer connection still
      // sees the lease as active until the caller commits.
      const row = await observerDb
        .selectFrom('computed_update_pause_scope')
        .select('resume_at')
        .executeTakeFirstOrThrow();
      expect(new Date(row.resume_at!).getTime()).toBeGreaterThan(Date.now());
      return result;
    });

    expect(admitted.isOk()).toBe(true);

    const listed = await registry.listScopes({ activeOnly: true });
    expect(listed.isOk()).toBe(true);
    expect(listed._unsafeUnwrap()).toHaveLength(0);
  });

  it('completes two concurrent computed writes on a two-connection pool', async () => {
    // Both transactions must hold a pooled connection before either admits;
    // otherwise the test cannot tell a nested checkout from an idle pool.
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => (release = resolve));
    let started = 0;
    const waitForPeer = async (): Promise<void> => {
      started += 1;
      if (started === 2) release();
      await bothStarted;
    };

    const admit = () =>
      concurrentDb.transaction().execute(async (trx) => {
        await waitForPeer();
        return concurrentRegistry.admitComputedWrite(
          { tableId: TABLE_ID, baseId: BASE_ID },
          bindTransaction(trx)
        );
      });

    const results = await Promise.all([admit(), admit()]);

    expect(results.map((result) => result.isOk())).toEqual([true, true]);
  });
});
