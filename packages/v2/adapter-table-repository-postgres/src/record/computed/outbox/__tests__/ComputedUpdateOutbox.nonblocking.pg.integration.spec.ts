import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import { PostgresUnitOfWorkTransaction } from '@teable/v2-adapter-db-postgres-shared';
import { ActorId, bindUnitOfWorkTransaction } from '@teable/v2-core';
import type { ILogger } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ComputedUpdateOutbox } from '../ComputedUpdateOutbox';
import type { ComputedUpdateOutboxTaskInput } from '../ComputedUpdateOutboxPayload';
import type { ComputedUpdateSeedTaskInput } from '../ComputedUpdateSeedPayload';
import {
  defaultComputedUpdateOutboxConfig,
  isSeedOutboxItem,
  isFieldBackfillOutboxItem,
} from '../IComputedUpdateOutbox';

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
      .createTable('space_data_db_binding')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('space_id', 'text', (col) => col.notNull())
      .addColumn('mode', 'text', (col) => col.notNull())
      .addColumn('state', 'text', (col) => col.notNull())
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
      .addColumn('worker_lane', 'text', (col) => col.notNull().defaultTo('production'))
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
    await db.schema
      .createTable('computed_update_change_frontier')
      .addColumn('scope_id', 'text', (col) => col.notNull())
      .addColumn('kind', 'text', (col) => col.notNull())
      .addColumn('table_id', 'text', (col) => col.notNull())
      .addColumn('record_id', 'text', (col) => col.notNull())
      .addColumn('field_id', 'text', (col) => col.notNull())
      .addPrimaryKeyConstraint('computed_update_change_frontier_pkey', [
        'scope_id',
        'kind',
        'table_id',
        'record_id',
        'field_id',
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
    await db.deleteFrom('computed_update_change_frontier').execute();
    await db.deleteFrom('computed_update_stage_ledger').execute();
    await db.deleteFrom('computed_update_outbox_seed').execute();
    await db.deleteFrom('computed_update_outbox').execute();
    await db.deleteFrom('table_meta').execute();
    await db.deleteFrom('base').execute();
    await db.deleteFrom('space').execute();
    await db.insertInto('space').values({ id: SPACE_ID, name: 'Space' }).execute();
    await db.insertInto('base').values({ id: BASE_ID, space_id: SPACE_ID, name: 'Base' }).execute();
    await db
      .insertInto('table_meta')
      .values({
        id: SEED_TABLE_ID,
        base_id: BASE_ID,
        name: 'Seed',
        deleted_time: null,
      })
      .execute();
  });

  it('still merges duplicate enqueues when the merge lock is free', async () => {
    const first = await outbox.enqueueOrMerge(createTaskInput('plan-free'));
    const second = await outbox.enqueueOrMerge(createTaskInput('plan-free'));

    expect(unwrap(first).merged).toBe(false);
    expect(unwrap(second).merged).toBe(true);
    expect(unwrap(second).taskId).toBe(unwrap(first).taskId);
    const claimed = await outbox.claimBatch({
      workerId: 'merge-worker',
      limit: 10,
    });
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

  it('T8158 locks only one family survivor while preserving every fragment seed', async () => {
    const planHash = 'survivor-lock-bound';
    const releaseMergeLock = await holdAdvisoryLock(holderDb, buildMergeLockKey(planHash));
    try {
      for (let index = 0; index < 4; index++) {
        unwrap(
          await outbox.enqueueOrMerge({
            ...createTaskInput(planHash),
            seedRecordIds: [`fragment-${index}`],
          })
        );
      }
    } finally {
      await releaseMergeLock();
    }
    const fragments = await db
      .selectFrom('computed_update_outbox')
      .select('id')
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    expect(fragments).toHaveLength(4);
    const merged = Promise.withResolvers<string>();
    const releaseTransaction = Promise.withResolvers<void>();
    const transaction = db.transaction().execute(async (trx) => {
      try {
        const context = bindUnitOfWorkTransaction(
          { actorId: unwrap(ActorId.create('test')) },
          new PostgresUnitOfWorkTransaction(trx, 'data')
        );
        const result = unwrap(
          await outbox.enqueueOrMerge(
            {
              ...createTaskInput(planHash),
              seedRecordIds: ['incoming'],
            },
            context
          )
        );
        expect(result.merged).toBe(true);
        merged.resolve(result.taskId);
        await releaseTransaction.promise;
      } catch (error) {
        merged.reject(error);
        throw error;
      }
    });
    const survivorId = await merged.promise;
    const freeSiblingIds: string[] = [];
    try {
      expect(survivorId).toBe(fragments[0]!.id);
      // Observe the chosen row's actual PostgreSQL lock from an independent session.
      await expect(
        holderDb.transaction().execute(async (trx) => {
          await sql`SELECT id FROM computed_update_outbox WHERE id = ${survivorId}
          FOR UPDATE NOWAIT`.execute(trx);
        })
      ).rejects.toMatchObject({ code: '55P03' });
      for (const sibling of fragments.slice(1)) {
        try {
          await holderDb.transaction().execute(async (trx) => {
            await sql`SELECT id FROM computed_update_outbox WHERE id = ${sibling.id}
              FOR UPDATE NOWAIT`.execute(trx);
          });
          freeSiblingIds.push(sibling.id);
        } catch (error) {
          // Report a bound violation after releasing the subject transaction;
          // unexpected PostgreSQL failures must not masquerade as lock evidence.
          expect(error).toMatchObject({ code: '55P03' });
        }
      }
    } finally {
      releaseTransaction.resolve();
      await transaction;
    }
    expect(freeSiblingIds, 'only the selected survivor may be row-locked').toEqual(
      fragments.slice(1).map((fragment) => fragment.id)
    );
    const [claimed] = unwrap(await outbox.claimBatch({ workerId: 'lock-bound-drain', limit: 1 }));
    if (!claimed || isFieldBackfillOutboxItem(claimed)) throw new Error('Expected seed union');
    expect(new Set(claimed.seedRecordIds)).toEqual(
      new Set(['fragment-0', 'fragment-1', 'fragment-2', 'fragment-3', 'incoming'])
    );
  });

  it('T8158 consolidates durable contention fragments before claim without losing seeds', async () => {
    const planHash = 'fragment-convergence';
    const extraTableId = `tbl${'e'.repeat(16)}`;
    const releaseLock = await holdAdvisoryLock(holderDb, buildMergeLockKey(planHash));
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          outbox.enqueueOrMerge({
            ...createTaskInput(planHash),
            seedRecordIds: [`rec-${index}`, 'rec-shared'],
            extraSeedRecords: [{ tableId: extraTableId, recordIds: [`extra-${index}`] }],
            affectedFieldIds: [FIELD_ID, `fld${String(index).repeat(16)}`],
          })
        )
      );
      results.forEach(unwrap);
      const fragments = await db.selectFrom('computed_update_outbox').selectAll().execute();
      expect(fragments).toHaveLength(8);
      expect(new Set(fragments.map((row) => row.plan_hash)).size).toBe(8);
      expect(fragments.every((row) => row.plan_hash.startsWith(`${planHash}:nolock:cnm`))).toBe(
        true
      );
    } finally {
      await releaseLock();
    }

    const [claimed] = unwrap(await outbox.claimBatch({ workerId: 'consolidator', limit: 1 }));
    expect(claimed).toBeDefined();
    if (!claimed || isSeedOutboxItem(claimed) || isFieldBackfillOutboxItem(claimed)) {
      throw new Error('Expected planned computed task');
    }
    expect(await db.selectFrom('computed_update_outbox').select('id').execute()).toHaveLength(1);
    expect(new Set(claimed!.seedRecordIds)).toEqual(
      new Set(['rec-shared', ...Array.from({ length: 8 }, (_, index) => `rec-${index}`)])
    );
    expect(claimed!.extraSeedRecords).toEqual([
      {
        tableId: extraTableId,
        recordIds: expect.arrayContaining(
          Array.from({ length: 8 }, (_, index) => `extra-${index}`)
        ),
      },
    ]);
    expect(new Set(claimed.affectedFieldIds)).toEqual(
      new Set([FIELD_ID, ...Array.from({ length: 8 }, (_, index) => `fld${String(index).repeat(16)}`)])
    );
    // The persisted uniqueness escape hatch remains, even on the survivor.
    expect(claimed!.planHash).toContain(':nolock:cnm');
  });

  it('T8163 admits old expensive work in deterministic rounds under sustained same-family arrivals', async () => {
    const fairOutbox = new ComputedUpdateOutbox(
      db,
      {
        ...defaultComputedUpdateOutboxConfig,
        seedInlineLimit: 0,
        maxSeedRecordsPerTask: 1,
      },
      createLogger(),
      db
    );
    const now = new Date('2030-01-01T00:00:00Z');
    const enqueueFragment = async (recordId: string, age: number, complexity: number) => {
      const release = await holdAdvisoryLock(holderDb, buildMergeLockKey('hot-family'));
      let taskId: string;
      try {
        taskId = unwrap(
          await fairOutbox.enqueueOrMerge({
            ...createTaskInput('hot-family'),
            seedRecordIds: [recordId],
            estimatedComplexity: complexity,
          })
        ).taskId;
      } finally {
        await release();
      }
      await db
        .updateTable('computed_update_outbox')
        .set({
          created_at: new Date(now.getTime() + age),
          next_run_at: now,
        })
        .where('id', '=', taskId)
        .execute();
    };
    await enqueueFragment('older-cheap', -60_000, 1);
    await enqueueFragment('old-expensive', -45_000, 1000);
    const served: string[] = [];
    for (let round = 0; round < 4; round++) {
      // Each round commits another bypass fragment of the *same* logical plan.
      // The seed bound prevents unlimited coalescing from hiding admission order.
      await enqueueFragment(`arrival-${round}`, round * 1000, 1);
      const tasks = unwrap(
        await fairOutbox.claimBatch({
          workerId: 'fair-worker',
          limit: 1,
          now: new Date(now.getTime() + round * 1000),
        })
      );
      expect(tasks).toHaveLength(1);
      if (!tasks[0] || isFieldBackfillOutboxItem(tasks[0])) throw new Error('Expected seeded task');
      served.push(...tasks[0]!.seedRecordIds);
      expect(unwrap(await fairOutbox.markDone(tasks[0]!))).toBe(true);
    }
    // Oldest eligible work first, not "all expensive work first"; continuing
    // cheaper arrivals cannot push the old expensive task past the second round.
    expect(served).toEqual(['older-cheap', 'old-expensive', 'arrival-0', 'arrival-1']);
  });

  it('skips the claim round without waiting while another session holds the global claim lock', async () => {
    await outbox.enqueueOrMerge(createTaskInput('plan-claim'));

    const releaseLock = await holdAdvisoryLock(holderDb, 'v2:outbox:claim:global');
    try {
      const startedAt = performance.now();
      const claimed = await outbox.claimBatch({
        workerId: 'it-worker',
        limit: 10,
      });
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

    const claimedAfterRelease = await outbox.claimBatch({
      workerId: 'it-worker',
      limit: 10,
    });
    expect(unwrap(claimedAfterRelease)).toHaveLength(1);
  });

  it('releases a task for retry without waiting while the merge lock is held elsewhere', async () => {
    await outbox.enqueueOrMerge(createTaskInput('plan-retry'));
    const claimed = await outbox.claimBatch({
      workerId: 'it-worker',
      limit: 10,
    });
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

  it('keeps the oldest enqueue time when a lock-miss retry merges into a newer pending task', async () => {
    const enqueued = unwrap(await outbox.enqueueOrMerge(createTaskInput('plan-age')));
    const oldestCreatedAt = new Date(Date.now() - 10 * 60 * 1000);
    await db
      .updateTable('computed_update_outbox')
      .set({ created_at: oldestCreatedAt })
      .where('id', '=', enqueued.taskId)
      .execute();

    const claimed = unwrap(await outbox.claimBatch({ workerId: 'it-worker', limit: 1 }));
    const task = claimed[0];
    expect(task).toBeDefined();
    // The driver round-trips timestamptz at second precision; compare seconds.
    const seconds = (value: Date | string) => Math.floor(new Date(value).getTime() / 1000);
    expect(seconds(task!.createdAt as Date)).toBe(seconds(oldestCreatedAt));

    // A newer pending task with the same hash appears while the first one is
    // processing; the lock-miss retry merges into it.
    await outbox.enqueueOrMerge(createTaskInput('plan-age'));
    const newerPending = await db
      .selectFrom('computed_update_outbox')
      .select(['id', 'created_at'])
      .where('status', '=', 'pending')
      .executeTakeFirstOrThrow();
    expect(String(newerPending.id)).not.toBe(task!.id);
    expect(seconds(newerPending.created_at as Date)).toBeGreaterThan(seconds(oldestCreatedAt));

    const released = unwrap(
      await outbox.releaseForRetry({
        task: task!,
        reason: 'Computed update lock unavailable: lock-key',
        retryDelayMs: 250,
      })
    );
    expect(released).toBe(true);

    // The surviving row keeps the age of the task that actually waited, so an
    // age-based escalation cannot be reset by every merge (T8079).
    const merged = await db
      .selectFrom('computed_update_outbox')
      .select(['id', 'status', 'created_at'])
      .where('id', '=', String(newerPending.id))
      .executeTakeFirstOrThrow();
    expect(merged.status).toBe('pending');
    expect(seconds(merged.created_at as Date)).toBe(seconds(oldestCreatedAt));
  });

  it('T8158 preserves spilled seed metadata across enqueue, retry and rollback', async () => {
    const seed = (recordId: string, fieldId: string): ComputedUpdateSeedTaskInput => ({
      taskType: 'seed',
      baseId: BASE_ID,
      seedTableId: SEED_TABLE_ID,
      seedRecordIds: [recordId],
      extraSeedRecords: [{ tableId: SEED_TABLE_ID, recordIds: ['shared'] }],
      beforeImageRecords: [{ recordId: 'shared', fieldValuesByDbName: { [fieldId]: recordId } }],
      changedFieldIds: [fieldId],
      changeType: 'update',
      planHash: 'seed-family',
      runId: recordId,
    });
    const release = await holdAdvisoryLock(
      holderDb,
      `v2:outbox:${BASE_ID}:${SEED_TABLE_ID}:seed-family:seed`
    );
    let firstId: string;
    try {
      firstId = unwrap(await outbox.enqueueSeedTask(seed('first', FIELD_ID))).taskId;
      unwrap(await outbox.enqueueSeedTask(seed('second', 'second-field')));
    } finally {
      await release();
    }
    const merged = unwrap(await outbox.enqueueSeedTask(seed('third', 'third-field')));
    expect(merged.merged).toBe(true);
    expect(merged.taskId).toBe(firstId);
    const before = await db
      .selectFrom('computed_update_outbox_seed')
      .selectAll()
      .orderBy('id')
      .execute();
    await expect(
      db.transaction().execute(async (trx) => {
        const context = bindUnitOfWorkTransaction(
          { actorId: unwrap(ActorId.create('test')) },
          new PostgresUnitOfWorkTransaction(trx, 'data')
        );
        const claimed = unwrap(
          await outbox.claimById({ taskId: firstId, workerId: 'rollback' }, context)
        );
        expect(claimed && isSeedOutboxItem(claimed)).toBe(true);
        if (!claimed || !isSeedOutboxItem(claimed)) throw new Error('Expected seed task');
        expect(new Set(claimed.seedRecordIds)).toEqual(
          new Set(['first', 'second', 'third', 'shared'])
        );
        throw new Error('abort consolidated claim');
      })
    ).rejects.toThrow('abort consolidated claim');
    expect(
      await db.selectFrom('computed_update_outbox_seed').selectAll().orderBy('id').execute()
    ).toEqual(before);
    expect(await db.selectFrom('computed_update_outbox').select('id').execute()).toHaveLength(2);

    const claimed = unwrap(await outbox.claimById({ taskId: firstId, workerId: 'seed-worker' }));
    if (!claimed || !isSeedOutboxItem(claimed)) throw new Error('Expected seed task');
    expect(new Set(claimed.changedFieldIds)).toEqual(
      new Set([FIELD_ID, 'second-field', 'third-field'])
    );
    expect(claimed.beforeImageRecords).toEqual([
      {
        recordId: 'shared',
        fieldValuesByDbName: {
          [FIELD_ID]: 'first',
          'second-field': 'second',
          'third-field': 'third',
        },
      },
    ]);
    const pending = unwrap(await outbox.enqueueSeedTask(seed('fourth', 'fourth-field')));
    expect(pending.taskId).not.toBe(claimed.id); // Processing rows never merge on enqueue.
    const retryNow = new Date('2030-01-01T00:00:00Z');
    expect(
      unwrap(
        await outbox.releaseForRetry({
          task: claimed,
          reason: 'lock busy',
          now: retryNow,
          retryDelayMs: 10_000,
        })
      )
    ).toBe(true);
    const survivor = await db
      .selectFrom('computed_update_outbox')
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(survivor.id).toBe(pending.taskId);
    expect(new Date(survivor.next_run_at).getTime()).toBeGreaterThanOrEqual(
      retryNow.getTime() + 5000
    );
    unwrap(await outbox.enqueueSeedTask(seed('fifth', 'fifth-field')));
    expect(
      unwrap(
        await outbox.claimBatch({
          workerId: 'early',
          limit: 1,
          now: retryNow,
        })
      )
    ).toHaveLength(0);
    const [retried] = unwrap(
      await outbox.claimBatch({
        workerId: 'due',
        limit: 1,
        now: new Date(survivor.next_run_at),
      })
    );
    if (!retried || !isSeedOutboxItem(retried)) throw new Error('Expected retried seed task');
    expect(new Set(retried.seedRecordIds)).toEqual(
      new Set(['first', 'second', 'third', 'fourth', 'fifth', 'shared'])
    );
  });

  it('T8158 keeps replay, continuation, lane and ledger ownership outside consolidation', async () => {
    const release = await holdAdvisoryLock(holderDb, buildMergeLockKey('isolated-family'));
    let ordinaryId: string;
    let ledgerId: string;
    let frontierId: string;
    try {
      ordinaryId = unwrap(
        await outbox.enqueueOrMerge({
          ...createTaskInput('isolated-family'),
          seedRecordIds: ['ordinary'],
        })
      ).taskId;
      ledgerId = unwrap(
        await outbox.enqueueOrMerge({
          ...createTaskInput('isolated-family'),
          seedRecordIds: ['ledger'],
        })
      ).taskId;
      frontierId = unwrap(
        await outbox.enqueueOrMerge({
          ...createTaskInput('isolated-family'),
          seedRecordIds: ['frontier-only'],
        })
      ).taskId;
    } finally {
      await release();
    }
    await db
      .insertInto('computed_update_stage_ledger')
      .values({
        scope_id: ledgerId,
        kind: 'frontier',
        table_id: SEED_TABLE_ID,
        record_id: 'frontier',
        seq: 1,
      })
      .execute();
    await db
      .insertInto('computed_update_change_frontier')
      .values({
        scope_id: frontierId,
        kind: 'changed',
        table_id: SEED_TABLE_ID,
        record_id: 'frontier-only',
        field_id: FIELD_ID,
      })
      .execute();
    const replay = unwrap(
      await outbox.enqueueOrMerge(createTaskInput('isolated-family:nolock:replay_archived'))
    );
    const continuation = unwrap(
      await outbox.enqueueOrMerge({
        ...createTaskInput('isolated-family:run:other:stage:1:from:predecessor'),
        ledgerScopeId: 'other-root',
      })
    );
    const laneOutbox = new ComputedUpdateOutbox(
      db,
      { ...defaultComputedUpdateOutboxConfig, workerLane: 'canary' },
      createLogger(),
      db
    );
    const lane = unwrap(await laneOutbox.enqueueOrMerge(createTaskInput('isolated-family')));
    const claimed = unwrap(await outbox.claimById({ taskId: ordinaryId, workerId: 'isolated' }));
    expect(claimed && !isFieldBackfillOutboxItem(claimed) && claimed.seedRecordIds).toEqual([
      'ordinary',
    ]);
    const remaining = await db.selectFrom('computed_update_outbox').select('id').execute();
    expect(new Set(remaining.map((row) => row.id))).toEqual(
      new Set([ordinaryId, ledgerId, frontierId, replay.taskId, continuation.taskId, lane.taskId])
    );
    expect(
      await db
        .selectFrom('computed_update_stage_ledger')
        .select('record_id')
        .where('scope_id', '=', ledgerId)
        .execute()
    ).toEqual([{ record_id: 'frontier' }]);
    expect(
      await db
        .selectFrom('computed_update_change_frontier')
        .select('record_id')
        .where('scope_id', '=', frontierId)
        .execute()
    ).toEqual([{ record_id: 'frontier-only' }]);
    const newMutation = unwrap(await outbox.enqueueOrMerge(createTaskInput('isolated-family')));
    expect(newMutation.merged).toBe(false);
    expect(newMutation.taskId).not.toBe(ledgerId);
  });

  it('T8158 protects exact-hash checkpoint roots and merges compatible explicit roots', async () => {
    const root = unwrap(
      await outbox.enqueueOrMerge({
        ...createTaskInput('exact-checkpoint-family'),
        seedRecordIds: ['root-seed'],
      })
    );
    await db
      .insertInto('computed_update_stage_ledger')
      .values({
        scope_id: root.taskId,
        kind: 'frontier',
        table_id: SEED_TABLE_ID,
        record_id: 'root-seed',
        seq: 1,
      })
      .execute();
    await db
      .insertInto('computed_update_change_frontier')
      .values({
        scope_id: root.taskId,
        kind: 'changed',
        table_id: SEED_TABLE_ID,
        record_id: 'root-seed',
        field_id: FIELD_ID,
      })
      .execute();
    const ordinary = unwrap(
      await outbox.enqueueOrMerge({
        ...createTaskInput('exact-checkpoint-family'),
        seedRecordIds: ['ordinary-seed'],
      })
    );
    expect(ordinary.merged).toBe(false);
    expect(ordinary.taskId).not.toBe(root.taskId);
    const rows = await db
      .selectFrom('computed_update_outbox')
      .select(['id', 'plan_hash'])
      .execute();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === ordinary.taskId)?.plan_hash).toContain(':nolock:cnm');
    for (const table of [
      'computed_update_stage_ledger',
      'computed_update_change_frontier',
    ] as const) {
      expect(
        await db.selectFrom(table).select('record_id').where('scope_id', '=', root.taskId).execute()
      ).toEqual([{ record_id: 'root-seed' }]);
    }
    const protectedRoot = unwrap(
      await outbox.enqueueOrMerge({
        ...createTaskInput('compatible-checkpoint-family'),
        ledgerScopeId: 'compatible-root',
        seedRecordIds: ['first'],
      })
    );
    const sameRoot = unwrap(
      await outbox.enqueueOrMerge({
        ...createTaskInput('compatible-checkpoint-family'),
        ledgerScopeId: 'compatible-root',
        seedRecordIds: ['second'],
      })
    );
    expect(sameRoot).toEqual({ taskId: protectedRoot.taskId, merged: true });
    const claimed = unwrap(
      await outbox.claimById({ taskId: protectedRoot.taskId, workerId: 'compatible-root' })
    );
    if (!claimed || isFieldBackfillOutboxItem(claimed) || isSeedOutboxItem(claimed))
      throw new Error('Expected planned task');
    expect(new Set(claimed.seedRecordIds)).toEqual(new Set(['first', 'second']));
    expect(claimed.ledgerScopeId).toBe('compatible-root');
  });

  it('T8158 does not merge cursor-only metadata into another implicit checkpoint root', async () => {
    const budget = { maxSteps: 1, maxFields: 1, maxEdges: 0 };
    const task = {
      ...createTaskInput('implicit-budget-family'),
      partialStageBudget: budget,
    };
    const root = unwrap(await outbox.enqueueOrMerge(task));
    await db
      .insertInto('computed_update_stage_ledger')
      .values({
        scope_id: root.taskId,
        kind: 'frontier',
        table_id: SEED_TABLE_ID,
        record_id: 'owned-root-record',
        seq: 1,
      })
      .execute();

    const incoming = unwrap(await outbox.enqueueOrMerge({ ...task, seedRecordIds: ['new-work'] }));

    expect(incoming.merged).toBe(false);
    expect(incoming.taskId).not.toBe(root.taskId);
    expect(
      await db
        .selectFrom('computed_update_stage_ledger')
        .select('record_id')
        .where('scope_id', '=', root.taskId)
        .execute()
    ).toEqual([{ record_id: 'owned-root-record' }]);
  });

  it('T8158 concurrent batch and by-ID claims neither duplicate nor lose fragment changes', async () => {
    const release = await holdAdvisoryLock(holderDb, buildMergeLockKey('claim-race'));
    const taskIds: string[] = [];
    try {
      const enqueued = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          outbox.enqueueOrMerge({
            ...createTaskInput('claim-race'),
            seedRecordIds: [`race-${index}`],
          })
        )
      );
      taskIds.push(...enqueued.map((result) => unwrap(result).taskId));
    } finally {
      await release();
    }
    const [batch, byId] = await Promise.all([
      outbox.claimBatch({ workerId: 'batch-race', limit: 1 }),
      outbox.claimById({ workerId: 'id-race', taskId: taskIds[7]! }),
    ]);
    const claimed = [...unwrap(batch), ...[unwrap(byId)].filter((task) => task !== null)];
    const served: string[] = [];
    for (const task of claimed) {
      if (isFieldBackfillOutboxItem(task)) throw new Error('Unexpected backfill');
      served.push(...task.seedRecordIds);
      expect(unwrap(await outbox.markDone(task))).toBe(true);
    }
    for (let round = 0; round < 8; round++) {
      const tasks = unwrap(await outbox.claimBatch({ workerId: 'drain-race', limit: 1 }));
      if (!tasks.length) break;
      for (const task of tasks) {
        if (isFieldBackfillOutboxItem(task)) throw new Error('Unexpected backfill');
        served.push(...task.seedRecordIds);
        expect(unwrap(await outbox.markDone(task))).toBe(true);
      }
    }
    expect(served.sort()).toEqual(Array.from({ length: 8 }, (_, index) => `race-${index}`));
    expect(await db.selectFrom('computed_update_outbox').select('id').execute()).toHaveLength(0);
  });

  it('T8158 limits each consolidation page and drains every remaining fragment', async () => {
    const release = await holdAdvisoryLock(holderDb, buildMergeLockKey('bounded-family'));
    try {
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, index) =>
          outbox.enqueueOrMerge({
            ...createTaskInput('bounded-family'),
            seedRecordIds: [`bounded-${index}`],
          })
        )
      );
      results.forEach(unwrap);
    } finally {
      await release();
    }
    const served: string[] = [];
    for (let round = 0; round < 2; round++) {
      const [task] = unwrap(await outbox.claimBatch({ workerId: 'bounded-worker', limit: 1 }));
      if (!task || isFieldBackfillOutboxItem(task)) throw new Error('Expected bounded seed union');
      expect(task.seedRecordIds).toHaveLength(round === 0 ? 33 : 7);
      served.push(...task.seedRecordIds);
      expect(unwrap(await outbox.markDone(task))).toBe(true);
    }
    expect(served.sort()).toEqual(
      Array.from({ length: 40 }, (_, index) => `bounded-${index}`).sort()
    );
    expect(await db.selectFrom('computed_update_outbox').select('id').execute()).toHaveLength(0);
  });

  it('T8158 consolidates backfill affected fields but keeps cursor continuations independent', async () => {
    const backfillFieldId = `fld${'d'.repeat(16)}`;
    const release = await holdAdvisoryLock(
      holderDb,
      `v2:outbox:${BASE_ID}:${SEED_TABLE_ID}:backfill-family:field-backfill`
    );
    let cursorId: string;
    try {
      for (const fieldId of [FIELD_ID, backfillFieldId]) {
        unwrap(
          await outbox.enqueueFieldBackfill({
            taskType: 'field-backfill',
            baseId: BASE_ID,
            tableId: SEED_TABLE_ID,
            fieldIds: [fieldId],
            runId: fieldId,
            planHash: 'backfill-family',
          })
        );
      }
      cursorId = unwrap(
        await outbox.enqueueFieldBackfill({
          taskType: 'field-backfill',
          baseId: BASE_ID,
          tableId: SEED_TABLE_ID,
          fieldIds: [FIELD_ID],
          runId: 'cursor',
          planHash: 'backfill-family',
          cursor: 'rec-cursor',
        })
      ).taskId;
    } finally {
      await release();
    }
    const [task] = unwrap(await outbox.claimBatch({ workerId: 'backfill-worker', limit: 1 }));
    if (!task || !isFieldBackfillOutboxItem(task)) throw new Error('Expected backfill');
    expect(new Set(task.fieldIds)).toEqual(new Set([FIELD_ID, backfillFieldId]));
    expect(await db.selectFrom('computed_update_outbox').select('id').execute()).toHaveLength(2);
    expect(unwrap(await outbox.markDone(task))).toBe(true);
    const cursor = unwrap(await outbox.claimById({ workerId: 'cursor-worker', taskId: cursorId }));
    expect(cursor && isFieldBackfillOutboxItem(cursor) && cursor.cursor).toBe('rec-cursor');
  });

  it('T8163 never age-promotes a retry before next_run_at even after fresh family merges', async () => {
    const now = new Date('2030-01-01T00:00:00Z');
    const first = unwrap(
      await outbox.enqueueOrMerge({
        ...createTaskInput('retry-fairness'),
        seedRecordIds: ['old'],
        estimatedComplexity: 1000,
      })
    );
    await db
      .updateTable('computed_update_outbox')
      .set({
        created_at: new Date(now.getTime() - 120_000),
      })
      .where('id', '=', first.taskId)
      .execute();
    const processing = unwrap(
      await outbox.claimById({
        taskId: first.taskId,
        workerId: 'retry-owner',
        now,
      })
    );
    if (!processing) throw new Error('Expected claimed retry owner');
    const pending = unwrap(
      await outbox.enqueueOrMerge({
        ...createTaskInput('retry-fairness'),
        seedRecordIds: ['pending'],
      })
    );
    await db
      .updateTable('computed_update_outbox')
      .set({ created_at: new Date(now.getTime() - 10_000) })
      .where('id', '=', pending.taskId)
      .execute();
    expect(
      unwrap(
        await outbox.releaseForRetry({
          task: processing,
          reason: 'computed lock busy',
          retryDelayMs: 10_000,
          now,
        })
      )
    ).toBe(true);
    const row = await db
      .selectFrom('computed_update_outbox')
      .selectAll()
      .where('id', '=', pending.taskId)
      .executeTakeFirstOrThrow();
    const due = new Date(row.next_run_at);
    expect(due.getTime()).toBeGreaterThanOrEqual(now.getTime() + 5000);
    unwrap(
      await outbox.enqueueOrMerge({
        ...createTaskInput('retry-fairness'),
        seedRecordIds: ['fresh'],
      })
    );
    expect(
      unwrap(
        await outbox.claimBatch({
          workerId: 'too-early',
          limit: 1,
          now: new Date(due.getTime() - 1),
        })
      )
    ).toHaveLength(0);
    const [task] = unwrap(await outbox.claimBatch({ workerId: 'eligible', limit: 1, now: due }));
    if (!task || isFieldBackfillOutboxItem(task)) throw new Error('Expected eligible seed union');
    expect(new Set(task.seedRecordIds)).toEqual(new Set(['old', 'pending', 'fresh']));
    expect(task.createdAt).toEqual(new Date(now.getTime() - 120_000));
  });
});
