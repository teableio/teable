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
 * Proof tests for stage-ledger compaction against a real Postgres. The ledger
 * is written and cleared by every computed stage, so an idle ledger keeps the
 * btree high-water mark of the largest churn wave: vacuum frees pages inside
 * the existing index file, and only a rewrite returns them. These tests build
 * that bloat the way production does (write a scope, clear it, repeat) and
 * assert the file comes back when a task completes with the ledger empty —
 * and stays untouched while a scope still holds rows or the table's lock.
 *
 * Run with:
 *   TEABLE_V2_RUN_STAGE_LEDGER_COMPACTION_INTEGRATION=1 \
 *   PRISMA_DATABASE_URL=postgresql://user:pass@host:5432/db \
 *   pnpm --filter @teable/v2-adapter-table-repository-postgres exec vitest run \
 *     src/record/computed/outbox/__tests__/ComputedUpdateOutbox.stageLedgerCompaction.pg.integration.spec.ts
 */
const runIntegration = process.env.TEABLE_V2_RUN_STAGE_LEDGER_COMPACTION_INTEGRATION === '1';
const adminDatabaseUrl = process.env.PRISMA_DATABASE_URL;
if (runIntegration && !adminDatabaseUrl) {
  throw new Error(
    'TEABLE_V2_RUN_STAGE_LEDGER_COMPACTION_INTEGRATION=1 requires PRISMA_DATABASE_URL'
  );
}
const describeCompaction = runIntegration ? describe : describe.skip;

const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

const LEDGER_TABLE = 'computed_update_stage_ledger';
const COMPACTION_MIN_BYTES = 4 * 1024;

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

type LoggedEvent = { level: string; message: string; fields?: Record<string, unknown> };

/** Housekeeping logs are fire-and-forget, so tests await them instead of racing. */
const loggedEvents: LoggedEvent[] = [];

const createLogger = (): ILogger => {
  const record =
    (level: string) =>
    (...args: unknown[]): void => {
      const [message, fields] = args;
      loggedEvents.push({
        level,
        message: String(message),
        fields:
          typeof fields === 'object' && fields !== null
            ? (fields as Record<string, unknown>)
            : undefined,
      });
    };
  return {
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    debug: record('debug'),
    child: () => createLogger(),
    scope: () => createLogger(),
  };
};

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

describeCompaction('ComputedUpdateOutbox stage-ledger compaction (pg integration)', () => {
  const tempDbName = `outbox_ledger_compact_it_${process.pid}_${Math.floor(Math.random() * 1e6)}`;
  let adminDb: Kysely<V1TeableDatabase>;
  let db: Kysely<V1TeableDatabase>;
  let holderDb: Kysely<V1TeableDatabase>;

  const createOutbox = (): ComputedUpdateOutbox =>
    new ComputedUpdateOutbox(
      db,
      {
        ...defaultComputedUpdateOutboxConfig,
        seedInlineLimit: 0,
        stageLedgerCompactionMinBytes: COMPACTION_MIN_BYTES,
      },
      createLogger(),
      db
    );

  const ledgerBytes = async (): Promise<number> => {
    const result = await sql<{ bytes: string }>`
      select pg_total_relation_size(${LEDGER_TABLE}::text::regclass)::text as bytes
    `.execute(db);
    return Number(result.rows[0]?.bytes ?? 0);
  };

  /** A wave peak leaves hundreds of MB; an emptied ledger must be far below it. */
  const WAVE_LEDGER_BYTES = 1 * 1024 * 1024;
  /** A reset ledger is a handful of pages (measured: 24 KiB), not a file with a wave. */
  const RESET_LEDGER_BYTES = 256 * 1024;

  /**
   * Poll until the relation drops under `limit`, then report the observed size
   * so the caller can assert it against its own bound. Polling while the attempt
   * is in flight would be counterproductive: the probe's own AccessShareLock can
   * refuse the attempt's single-shot NOWAIT lock, so callers wait for the
   * compaction event first and only then read the relation size.
   */
  const waitForLedgerBytesBelow = async (limit: number, timeoutMs = 5_000): Promise<number> => {
    const startedAt = Date.now();
    for (;;) {
      const bytes = await ledgerBytes();
      if (bytes < limit) return bytes;
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`ledger stayed at ${bytes} bytes, expected below ${limit}`);
      }
      await sleep(25);
    }
  };

  const ledgerRows = async (scopeId?: string): Promise<number> => {
    const query = sql<{ count: number }>`select count(*)::int as count from ${sql.table(
      LEDGER_TABLE
    )}`;
    const result = scopeId
      ? await sql<{ count: number }>`select count(*)::int as count from ${sql.table(
          LEDGER_TABLE
        )} where scope_id = ${scopeId}`.execute(db)
      : await query.execute(db);
    return Number(result.rows[0]?.count ?? 0);
  };

  /**
   * One finished scope's lifecycle as production runs it: partial batches write
   * excluded and frontier rows, the retired head moves to 'consumed', and stage
   * settlement clears the whole scope. Repeated waves leave a bloated index
   * file behind an empty table because PostgreSQL never returns the pages.
   */
  const runChurnWave = async (scopeId: string, rows: number): Promise<void> => {
    await sql`
      insert into ${sql.table(LEDGER_TABLE)} (scope_id, kind, table_id, record_id, seq)
      select ${scopeId}, 'excluded', 'tbl' || substr(md5(g::text), 1, 17),
             'rec' || substr(md5('e' || g::text || random()::text), 1, 17), 0
      from generate_series(1, ${rows}) g
    `.execute(db);
    await sql`
      insert into ${sql.table(LEDGER_TABLE)} (scope_id, kind, table_id, record_id, seq)
      select ${scopeId}, 'frontier', 'tbl' || substr(md5(g::text), 1, 17),
             'rec' || substr(md5('f' || g::text || random()::text), 1, 17), g
      from generate_series(1, ${rows}) g
    `.execute(db);
    await sql`
      insert into ${sql.table(LEDGER_TABLE)} (scope_id, kind, table_id, record_id, seq)
      select scope_id, 'consumed', table_id, record_id, seq
      from ${sql.table(LEDGER_TABLE)}
      where scope_id = ${scopeId} and kind = 'frontier' and seq <= ${Math.trunc(rows / 2)}
      on conflict (scope_id, kind, table_id, record_id) do nothing
    `.execute(db);
    await sql`
      delete from ${sql.table(LEDGER_TABLE)}
      where scope_id = ${scopeId} and kind = 'frontier' and seq <= ${Math.trunc(rows / 2)}
    `.execute(db);
    await sql`delete from ${sql.table(LEDGER_TABLE)} where scope_id = ${scopeId}`.execute(db);
    await sql`vacuum ${sql.table(LEDGER_TABLE)}`.execute(db);
  };

  let consumedCompactionEvents = 0;
  const compactionEvents = (): LoggedEvent[] =>
    loggedEvents.filter((event) =>
      event.message.startsWith('computed:outbox:stage_ledger_compact')
    );

  const waitForCompactionEvent = async (timeoutMs = 5_000): Promise<LoggedEvent> => {
    const startedAt = Date.now();
    for (;;) {
      const events = compactionEvents();
      if (events.length > consumedCompactionEvents) {
        consumedCompactionEvents += 1;
        return events[consumedCompactionEvents - 1]!;
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error('stage ledger compaction event was not logged in time');
      }
      await sleep(25);
    }
  };

  /** Complete one real task without waiting for its fire-and-forget housekeeping. */
  const completeTask = async (instance: ComputedUpdateOutbox, planHash: string): Promise<void> => {
    unwrap(await instance.enqueueOrMerge(createTaskInput(planHash)));
    const claimed = unwrap(await instance.claimBatch({ workerId: 'it-worker', limit: 10 }));
    expect(claimed).toHaveLength(1);
    const done = unwrap(await instance.markDone(claimed[0]!));
    expect(done).toBe(true);
  };

  /** Complete one real task and wait for the compaction event it schedules. */
  const completeOneTask = async (
    instance: ComputedUpdateOutbox,
    planHash: string
  ): Promise<LoggedEvent> => {
    await completeTask(instance, planHash);
    return waitForCompactionEvent();
  };

  /** Pin the ledger's table lock in an open transaction until released. */
  const holdLedgerLock = async (): Promise<() => Promise<void>> => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markAcquired!: () => void;
    const acquired = new Promise<void>((resolve) => {
      markAcquired = resolve;
    });
    const holder = holderDb.transaction().execute(async (trx) => {
      await sql`lock table ${sql.table(LEDGER_TABLE)} in row exclusive mode`.execute(trx);
      markAcquired();
      await released;
    });
    await acquired;
    return async () => {
      release();
      await holder;
    };
  };

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
      .createTable('space_data_db_binding')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('space_id', 'text', (col) => col.notNull())
      .addColumn('mode', 'text', (col) => col.notNull())
      .addColumn('state', 'text', (col) => col.notNull())
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
    // Production DDL of the ledger, both indexes included.
    await db.schema
      .createTable(LEDGER_TABLE)
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
      CREATE INDEX "computed_update_stage_ledger_scope_id_kind_seq_idx"
      ON "computed_update_stage_ledger"("scope_id", "kind", "seq")
    `.execute(db);
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
  }, 120_000);

  afterAll(async () => {
    await holderDb?.destroy();
    await db?.destroy();
    if (adminDb) {
      await sql.raw(`drop database if exists "${tempDbName}" with (force)`).execute(adminDb);
      await adminDb.destroy();
    }
  });

  beforeEach(async () => {
    // Housekeeping is fire-and-forget: keep the array and move the cursor past
    // anything an earlier case logged late instead of clearing it.
    consumedCompactionEvents = compactionEvents().length;
    await sql`truncate table ${sql.table(LEDGER_TABLE)}`.execute(db);
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

  it('returns the space of an emptied ledger when a task completes', async () => {
    const instance = createOutbox();
    await runChurnWave(`cuo${'d'.repeat(16)}`, 30_000);
    await runChurnWave(`cuo${'e'.repeat(16)}`, 30_000);
    const bloated = await ledgerBytes();
    expect(bloated).toBeGreaterThan(WAVE_LEDGER_BYTES);
    expect(await ledgerRows()).toBe(0);

    await completeTask(instance, 'plan-compact');
    expect((await waitForCompactionEvent()).message).toBe('computed:outbox:stage_ledger_compacted');

    const reclaimed = await waitForLedgerBytesBelow(WAVE_LEDGER_BYTES);
    expect(reclaimed).toBeLessThan(RESET_LEDGER_BYTES);

    // The relation stays usable for the next scope after being reset.
    await sql`
      insert into ${sql.table(LEDGER_TABLE)} (scope_id, kind, table_id, record_id, seq)
      values ('cuoafter', 'frontier', 'tblaaaaaaaaaaaaaaaaa', 'recaaaaaaaaaaaaaaaaa', 1)
    `.execute(db);
    expect(await ledgerRows('cuoafter')).toBe(1);
  });

  it('keeps a live scope’s rows and file untouched', async () => {
    const instance = createOutbox();
    await runChurnWave(`cuo${'f'.repeat(16)}`, 30_000);
    await sql`
      insert into ${sql.table(LEDGER_TABLE)} (scope_id, kind, table_id, record_id, seq)
      values ('cuolive', 'excluded', 'tblaaaaaaaaaaaaaaaaa', 'recaaaaaaaaaaaaaaaaa', 0)
    `.execute(db);
    const before = await ledgerBytes();
    expect(before).toBeGreaterThan(WAVE_LEDGER_BYTES);

    const event = await completeOneTask(instance, 'plan-live');
    expect(event.message).toBe('computed:outbox:stage_ledger_compaction_skipped');
    expect(event.fields?.reason).toBe('in_use');

    expect(await ledgerRows('cuolive')).toBe(1);
    expect(await ledgerBytes()).toBe(before);
  });

  it('compacts at most once per interval per outbox instance', async () => {
    const instance = createOutbox();
    await runChurnWave(`cuo${'h'.repeat(16)}`, 30_000);
    expect((await completeOneTask(instance, 'plan-rate-first')).message).toBe(
      'computed:outbox:stage_ledger_compacted'
    );

    // A new peak with the same instance: housekeeping is rate limited, so the
    // file waits for a later interval instead of resetting on every task.
    await runChurnWave(`cuo${'i'.repeat(16)}`, 30_000);
    const secondPeak = await ledgerBytes();
    expect(secondPeak).toBeGreaterThan(WAVE_LEDGER_BYTES);
    const eventsBefore = compactionEvents().length;
    await completeTask(instance, 'plan-rate-second');
    await sleep(300);
    expect(compactionEvents()).toHaveLength(eventsBefore);
    // Rate limited: the second peak keeps its file byte for byte until a later interval.
    expect(await ledgerBytes()).toBe(secondPeak);
  });

  it('skips compaction while another session holds the ledger', async () => {
    const instance = createOutbox();
    await runChurnWave(`cuo${'g'.repeat(16)}`, 30_000);
    const bloated = await ledgerBytes();
    expect(bloated).toBeGreaterThan(WAVE_LEDGER_BYTES);
    expect(await ledgerRows()).toBe(0);

    // ROW EXCLUSIVE conflicts with the ACCESS EXCLUSIVE the reset needs, while
    // the table stays empty: the reset must refuse rather than wait.
    const releaseLock = await holdLedgerLock();
    try {
      const event = await completeOneTask(instance, 'plan-contended');
      expect(event.message).toBe('computed:outbox:stage_ledger_compaction_skipped');
      expect(event.fields?.reason).toBe('lock_unavailable');
      expect(await ledgerBytes()).toBe(bloated);
    } finally {
      await releaseLock();
    }

    // The refusal only defers housekeeping: a later tick reclaims the file.
    await completeTask(createOutbox(), 'plan-after-contention');
    expect((await waitForCompactionEvent()).message).toBe('computed:outbox:stage_ledger_compacted');
    expect(await waitForLedgerBytesBelow(WAVE_LEDGER_BYTES)).toBeLessThan(RESET_LEDGER_BYTES);
  });
});
