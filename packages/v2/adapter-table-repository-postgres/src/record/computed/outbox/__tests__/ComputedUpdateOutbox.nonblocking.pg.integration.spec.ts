import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import type { ILogger } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ComputedUpdateOutbox } from '../ComputedUpdateOutbox';
import type { ComputedUpdateOutboxTaskInput } from '../ComputedUpdateOutboxPayload';
import { defaultComputedUpdateOutboxConfig } from '../IComputedUpdateOutbox';

/**
 * Proof tests for the non-blocking outbox lock behavior. They require a real Postgres
 * with two independent sessions: a holder session pins an advisory lock inside an open
 * transaction while the subject session runs enqueue/claim/release. With the previous
 * blocking pg_advisory_xact_lock implementation every one of these calls would hang
 * until the holder commits (i.e. the test would time out); the try-lock implementation
 * must return within milliseconds while the lock is STILL held.
 *
 * Run with:
 *   TEABLE_V2_RUN_OUTBOX_LOCK_INTEGRATION=1 \
 *   PRISMA_DATABASE_URL=postgresql://user:pass@host:5432/db \
 *   pnpm --filter @teable/v2-adapter-table-repository-postgres exec vitest run \
 *     src/record/computed/outbox/__tests__/ComputedUpdateOutbox.nonblocking.pg.integration.spec.ts
 */
const runIntegration = process.env.TEABLE_V2_RUN_OUTBOX_LOCK_INTEGRATION === '1';
const adminDatabaseUrl = process.env.PRISMA_DATABASE_URL;
if (runIntegration && !adminDatabaseUrl) {
  throw new Error('TEABLE_V2_RUN_OUTBOX_LOCK_INTEGRATION=1 requires PRISMA_DATABASE_URL');
}
const describeNonBlocking = runIntegration ? describe : describe.skip;

/** Generous ceiling: non-blocking calls finish in milliseconds; blocking ones never do. */
const NON_BLOCKING_CEILING_MS = 3_000;

const unwrap = <T, E extends { message: string }>(result: {
  isErr(): boolean;
  _unsafeUnwrap(): T;
  _unsafeUnwrapErr(): E;
}): T => {
  if (result.isErr()) {
    throw new Error(`Expected Ok, got Err: ${result._unsafeUnwrapErr().message}`);
  }
  return result._unsafeUnwrap();
};

const BASE_ID = `bse${'a'.repeat(16)}`;
const SPACE_ID = `spc${'s'.repeat(16)}`;
const SEED_TABLE_ID = `tbl${'b'.repeat(16)}`;
const FIELD_ID = `fld${'c'.repeat(16)}`;

const createLogger = (): ILogger => ({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  child: () => createLogger(),
  scope: () => createLogger(),
});

const createTaskInput = (planHash: string): ComputedUpdateOutboxTaskInput => ({
  baseId: BASE_ID,
  seedTableId: SEED_TABLE_ID,
  seedRecordIds: ['rec1'],
  extraSeedRecords: [],
  beforeImageRecords: [],
  steps: [{ level: 0, tableId: SEED_TABLE_ID, fieldIds: [FIELD_ID] }],
  sameTableBatches: [
    {
      tableId: SEED_TABLE_ID,
      steps: [{ level: 0, tableId: SEED_TABLE_ID, fieldIds: [FIELD_ID] }],
      minLevel: 0,
      maxLevel: 0,
    },
  ],
  edges: [],
  estimatedComplexity: 1,
  changeType: 'update',
  planHash,
  dirtyStats: [{ tableId: SEED_TABLE_ID, recordCount: 1 }],
  runId: `run-${planHash}`,
  originRunIds: [],
  runTotalSteps: 1,
  runCompletedStepsBefore: 0,
  affectedTableIds: [SEED_TABLE_ID],
  affectedFieldIds: [FIELD_ID],
  syncMaxLevel: 0,
});

const buildMergeLockKey = (planHash: string): string =>
  `v2:outbox:${BASE_ID}:${SEED_TABLE_ID}:${planHash}:update`;

/**
 * Pin an advisory xact lock in an open transaction on `db` until the returned
 * release callback is invoked. Resolves only after the lock is actually held.
 */
const holdAdvisoryLock = async (
  db: Kysely<V1TeableDatabase>,
  key: string
): Promise<() => Promise<void>> => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markAcquired!: () => void;
  const acquired = new Promise<void>((resolve) => {
    markAcquired = resolve;
  });
  const holder = db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(
      ('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint
    ), 'holder' as lock_scope_test_holder`.execute(trx);
    markAcquired();
    await released;
  });
  await acquired;
  return async () => {
    release();
    await holder;
  };
};

describeNonBlocking('ComputedUpdateOutbox non-blocking locks (pg integration)', () => {
  const tempDbName = `outbox_lock_it_${process.pid}_${Math.floor(Math.random() * 1e6)}`;
  let adminDb: Kysely<V1TeableDatabase>;
  let db: Kysely<V1TeableDatabase>;
  let holderDb: Kysely<V1TeableDatabase>;
  let outbox: ComputedUpdateOutbox;

  beforeAll(async () => {
    adminDb = await createV2PostgresDb<V1TeableDatabase>({
      pg: { connectionString: adminDatabaseUrl! },
    });
    await sql.raw(`create database "${tempDbName}"`).execute(adminDb);

    const tempUrl = new URL(adminDatabaseUrl!);
    tempUrl.pathname = `/${tempDbName}`;
    db = await createV2PostgresDb<V1TeableDatabase>({
      pg: { connectionString: tempUrl.toString() },
    });
    holderDb = await createV2PostgresDb<V1TeableDatabase>({
      pg: { connectionString: tempUrl.toString() },
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
      .createTable('computed_update_outbox')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('base_id', 'text', (col) => col.notNull())
      .addColumn('seed_table_id', 'text', (col) => col.notNull())
      .addColumn('seed_record_ids', sql`jsonb`)
      .addColumn('change_type', 'text', (col) => col.notNull())
      .addColumn('steps', sql`jsonb`)
      .addColumn('edges', sql`jsonb`)
      .addColumn('status', 'text', (col) => col.notNull())
      .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('max_attempts', 'integer', (col) => col.notNull().defaultTo(8))
      .addColumn('next_run_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addColumn('locked_at', 'timestamptz')
      .addColumn('locked_by', 'text')
      .addColumn('last_error', 'text')
      .addColumn('estimated_complexity', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('plan_hash', 'text', (col) => col.notNull())
      .addColumn('dirty_stats', sql`jsonb`)
      .addColumn('affected_table_ids', sql`text[]`, (col) =>
        col.notNull().defaultTo(sql`ARRAY[]::text[]`)
      )
      .addColumn('affected_field_ids', sql`text[]`, (col) =>
        col.notNull().defaultTo(sql`ARRAY[]::text[]`)
      )
      .addColumn('sync_max_level', 'integer')
      .addColumn('run_id', 'text', (col) => col.notNull())
      .addColumn('origin_run_ids', sql`text[]`, (col) =>
        col.notNull().defaultTo(sql`ARRAY[]::text[]`)
      )
      .addColumn('run_total_steps', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('run_completed_steps_before', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('source_changed_at', 'timestamptz')
      .addColumn('stage_depth', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('predecessor_task_id', 'text')
      .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .execute();
    await db.schema
      .createTable('computed_update_outbox_seed')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('task_id', 'text', (col) => col.notNull())
      .addColumn('table_id', 'text', (col) => col.notNull())
      .addColumn('record_id', 'text', (col) => col.notNull())
      .execute();
    await sql`
      CREATE UNIQUE INDEX "computed_update_outbox_seed_task_id_table_id_record_id_key"
      ON "computed_update_outbox_seed"("task_id", "table_id", "record_id")
    `.execute(db);

    await db.schema
      .createTable('computed_update_stage_ledger')
      .ifNotExists()
      .addColumn('scope_id', 'text', (col) => col.notNull())
      .addColumn('kind', 'text', (col) => col.notNull())
      .addColumn('table_id', 'text', (col) => col.notNull())
      .addColumn('record_id', 'text', (col) => col.notNull())
      .addColumn('seq', 'bigint', (col) => col.notNull().defaultTo(0))
      .addPrimaryKeyConstraint('computed_update_stage_ledger_pkey', [
        'scope_id',
        'kind',
        'table_id',
        'record_id',
      ])
      .execute();
    await sql`
      CREATE UNIQUE INDEX "computed_update_outbox_pending_unique_idx"
      ON "computed_update_outbox"("base_id", "seed_table_id", "plan_hash", "change_type")
      WHERE "status" = 'pending'
    `.execute(db);
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

    outbox = new ComputedUpdateOutbox(
      db,
      { ...defaultComputedUpdateOutboxConfig, seedInlineLimit: 0 },
      createLogger(),
      db
    );
  }, 60_000);

  afterAll(async () => {
    await holderDb?.destroy();
    await db?.destroy();
    if (adminDb) {
      await sql.raw(`drop database if exists "${tempDbName}" with (force)`).execute(adminDb);
      await adminDb.destroy();
    }
  });

  beforeEach(async () => {
    await db.deleteFrom('computed_update_pause_scope').execute();
    await db.deleteFrom('computed_update_outbox_seed').execute();
    await db.deleteFrom('computed_update_outbox').execute();
    await db.deleteFrom('table_meta').execute();
    await db.deleteFrom('base').execute();
    await db.deleteFrom('space').execute();
    await db.insertInto('space').values({ id: SPACE_ID, name: 'Space' }).execute();
    await db.insertInto('base').values({ id: BASE_ID, space_id: SPACE_ID, name: 'Base' }).execute();
    await db
      .insertInto('table_meta')
      .values({ id: SEED_TABLE_ID, base_id: BASE_ID, name: 'Seed', deleted_time: null })
      .execute();
  });

  it('still merges duplicate enqueues when the merge lock is free', async () => {
    const first = await outbox.enqueueOrMerge(createTaskInput('plan-free'));
    const second = await outbox.enqueueOrMerge(createTaskInput('plan-free'));

    expect(unwrap(first).merged).toBe(false);
    expect(unwrap(second).merged).toBe(true);
    expect(unwrap(second).taskId).toBe(unwrap(first).taskId);
    const claimed = await outbox.claimBatch({ workerId: 'merge-worker', limit: 10 });
    expect(unwrap(claimed)[0]?.sameTableBatches).toEqual(
      createTaskInput('plan-free').sameTableBatches
    );
  });

  it('enqueues without waiting while another session holds the merge lock', async () => {
    const releaseLock = await holdAdvisoryLock(holderDb, buildMergeLockKey('plan-contended'));
    try {
      const startedAt = performance.now();
      const result = await outbox.enqueueOrMerge(createTaskInput('plan-contended'));
      const elapsedMs = performance.now() - startedAt;

      // The holder transaction is still open here: a blocking implementation
      // could not have returned yet.
      expect(elapsedMs).toBeLessThan(NON_BLOCKING_CEILING_MS);
      expect(unwrap(result).merged).toBe(false);

      const row = await db
        .selectFrom('computed_update_outbox')
        .select(['plan_hash', 'status'])
        .where('id', '=', unwrap(result).taskId)
        .executeTakeFirstOrThrow();
      expect(String(row.plan_hash)).toContain('plan-contended:nolock:');
      expect(row.status).toBe('pending');
    } finally {
      await releaseLock();
    }
  });

  it('skips the claim round without waiting while another session holds the global claim lock', async () => {
    await outbox.enqueueOrMerge(createTaskInput('plan-claim'));

    const releaseLock = await holdAdvisoryLock(holderDb, 'v2:outbox:claim:global');
    try {
      const startedAt = performance.now();
      const claimed = await outbox.claimBatch({ workerId: 'it-worker', limit: 10 });
      const elapsedMs = performance.now() - startedAt;

      expect(elapsedMs).toBeLessThan(NON_BLOCKING_CEILING_MS);
      expect(unwrap(claimed)).toHaveLength(0);

      const row = await db
        .selectFrom('computed_update_outbox')
        .select(['status', 'locked_by'])
        .executeTakeFirstOrThrow();
      expect(row.status).toBe('pending');
      expect(row.locked_by).toBeNull();
    } finally {
      await releaseLock();
    }

    const claimedAfterRelease = await outbox.claimBatch({ workerId: 'it-worker', limit: 10 });
    expect(unwrap(claimedAfterRelease)).toHaveLength(1);
  });

  it('releases a task for retry without waiting while the merge lock is held elsewhere', async () => {
    await outbox.enqueueOrMerge(createTaskInput('plan-retry'));
    const claimed = await outbox.claimBatch({ workerId: 'it-worker', limit: 10 });
    const task = unwrap(claimed)[0];
    expect(task).toBeDefined();

    const releaseLock = await holdAdvisoryLock(holderDb, buildMergeLockKey('plan-retry'));
    try {
      const startedAt = performance.now();
      const released = await outbox.releaseForRetry({
        task,
        reason: 'lock busy',
        retryDelayMs: 250,
      });
      const elapsedMs = performance.now() - startedAt;

      expect(elapsedMs).toBeLessThan(NON_BLOCKING_CEILING_MS);
      expect(unwrap(released)).toBe(true);

      const row = await db
        .selectFrom('computed_update_outbox')
        .select(['status', 'plan_hash', 'next_run_at', 'updated_at'])
        .where('id', '=', task.id)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe('pending');
      expect(String(row.plan_hash)).toContain('plan-retry:nolock:');
      // Requeue delay carries jitter across [0.5x, 1.5x) of retryDelayMs.
      const delayMs =
        new Date(row.next_run_at as Date).getTime() - new Date(row.updated_at as Date).getTime();
      expect(delayMs).toBeGreaterThanOrEqual(125);
      expect(delayMs).toBeLessThan(375);
    } finally {
      await releaseLock();
    }
  });
});
