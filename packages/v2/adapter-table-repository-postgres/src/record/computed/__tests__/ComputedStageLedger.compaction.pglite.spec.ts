import type { ILogger } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createPGliteDb,
  type PGliteTestDb,
} from '../../../schema/visitors/__tests__/helpers/createPGliteDb';
import { STAGE_LEDGER_TABLE, compactStageLedgerWhenEmpty } from '../ComputedStageLedger';
import { ComputedUpdateOutbox } from '../outbox/ComputedUpdateOutbox';
import type { ComputedUpdateOutboxTaskInput } from '../outbox/ComputedUpdateOutboxPayload';
import { defaultComputedUpdateOutboxConfig } from '../outbox/IComputedUpdateOutbox';

/**
 * A stage ledger is empty whenever no scope holds state, yet PostgreSQL never
 * shrinks a btree file on its own: vacuum recycles emptied pages inside the
 * existing index file, so the high-water mark of the largest churn wave
 * survives every later cleanup. Compaction resets the table while it is empty
 * and must never touch a ledger a live scope is holding.
 */
const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

describe('stage ledger compaction (pglite)', () => {
  let created: PGliteTestDb;

  beforeAll(async () => {
    created = await createPGliteDb();
    await created.pglite.exec(`
      CREATE TABLE ${STAGE_LEDGER_TABLE} (
        scope_id text NOT NULL,
        kind text NOT NULL,
        table_id text NOT NULL,
        record_id text NOT NULL,
        seq bigint NOT NULL DEFAULT 0,
        PRIMARY KEY (scope_id, kind, table_id, record_id)
      );
      CREATE INDEX computed_update_stage_ledger_scope_id_kind_seq_idx
        ON ${STAGE_LEDGER_TABLE} (scope_id, kind, seq);
    `);
  });

  afterAll(async () => created.db.destroy());

  beforeEach(async () => {
    await created.pglite.exec(`TRUNCATE ${STAGE_LEDGER_TABLE}`);
  });

  const totalBytes = async (): Promise<number> => {
    const result = await sql<{ bytes: string }>`
      select pg_total_relation_size(${STAGE_LEDGER_TABLE}::text::regclass)::text as bytes
    `.execute(created.db);
    return Number(result.rows[0]?.bytes ?? 0);
  };

  /** One finished scope's write-and-clear cycle: the workload that bloats the file. */
  const churn = async (scopeId: string, rows: number): Promise<void> => {
    await sql`
      insert into ${sql.table(STAGE_LEDGER_TABLE)} (scope_id, kind, table_id, record_id, seq)
      select ${scopeId}, 'excluded', 'tbl' || substr(md5(g::text), 1, 17),
             'rec' || substr(md5('r' || g::text || random()::text), 1, 17), 0
      from generate_series(1, ${rows}) g
    `.execute(created.db);
    await sql`
      insert into ${sql.table(STAGE_LEDGER_TABLE)} (scope_id, kind, table_id, record_id, seq)
      select ${scopeId}, 'consumed', 'tbl' || substr(md5(g::text), 1, 17),
             'rec' || substr(md5('c' || g::text || random()::text), 1, 17), g
      from generate_series(1, ${Math.trunc(rows / 4)}) g
    `.execute(created.db);
    await sql`delete from ${sql.table(STAGE_LEDGER_TABLE)} where scope_id = ${scopeId}`.execute(
      created.db
    );
  };

  const countRows = async (scopeId: string): Promise<number> => {
    const result = await sql<{ count: number }>`
      select count(*)::int as count from ${sql.table(STAGE_LEDGER_TABLE)}
      where scope_id = ${scopeId}
    `.execute(created.db);
    return Number(result.rows[0]?.count ?? 0);
  };

  it('returns the file of an emptied ledger and keeps the table usable', async () => {
    await churn('cuosettled', 20_000);
    const bloated = await totalBytes();
    expect(bloated).toBeGreaterThan(1_000_000);
    expect(await countRows('cuosettled')).toBe(0);

    const outcome = (
      await compactStageLedgerWhenEmpty(created.db, { minBytes: 1 })
    )._unsafeUnwrap();

    expect(outcome.compacted).toBe(true);
    expect(outcome.bytesBefore).toBe(bloated);
    expect(await totalBytes()).toBeLessThan(bloated);

    await churn('cuoagain', 100);
    expect(await countRows('cuoagain')).toBe(0);
  });

  it('keeps rows and file while a scope still holds the ledger', async () => {
    await churn('cuolive', 20_000);
    await sql`
      insert into ${sql.table(STAGE_LEDGER_TABLE)} (scope_id, kind, table_id, record_id, seq)
      values ('cuolive', 'frontier', 'tblaaaaaaaaaaaaaaaaa', 'recaaaaaaaaaaaaaaaaa', 1)
    `.execute(created.db);
    const before = await totalBytes();

    const outcome = (
      await compactStageLedgerWhenEmpty(created.db, { minBytes: 1 })
    )._unsafeUnwrap();

    expect(outcome.compacted).toBe(false);
    expect(outcome.skipped).toBe('in_use');
    expect(await countRows('cuolive')).toBe(1);
    expect(await totalBytes()).toBe(before);
  });

  it('treats a data DB without the ledger as nothing to compact', async () => {
    const bare = await createPGliteDb();
    try {
      const outcome = (await compactStageLedgerWhenEmpty(bare.db, { minBytes: 1 }))._unsafeUnwrap();
      expect(outcome.compacted).toBe(false);
      expect(outcome.bytesBefore).toBe(0);
    } finally {
      await bare.db.destroy();
    }
  });

  it('compacts a schema-qualified ledger (BYODB shape)', async () => {
    const scoped = await createPGliteDb();
    try {
      await scoped.pglite.exec(`
        CREATE SCHEMA "tenant_internal";
        CREATE TABLE "tenant_internal".${STAGE_LEDGER_TABLE} (
          scope_id text NOT NULL,
          kind text NOT NULL,
          table_id text NOT NULL,
          record_id text NOT NULL,
          seq bigint NOT NULL DEFAULT 0,
          PRIMARY KEY (scope_id, kind, table_id, record_id)
        );
      `);
      scoped.db = scoped.db.withSchema('tenant_internal') as Kysely<V1TeableDatabase>;

      await sql`
        insert into "tenant_internal".${sql.table(STAGE_LEDGER_TABLE)}
          (scope_id, kind, table_id, record_id, seq)
        select 'cuoscoped', 'excluded', 'tbl' || substr(md5(g::text), 1, 17),
               'rec' || substr(md5('s' || g::text || random()::text), 1, 17), 0
        from generate_series(1, 20000) g
      `.execute(scoped.db);
      await sql`delete from "tenant_internal".${sql.table(STAGE_LEDGER_TABLE)}`.execute(scoped.db);
      const bytes = async () => {
        const result = await sql<{ bytes: string }>`
          select pg_total_relation_size(
            ${'tenant_internal.' + STAGE_LEDGER_TABLE}::text::regclass
          )::text as bytes
        `.execute(scoped.db);
        return Number(result.rows[0]?.bytes ?? 0);
      };
      const bloated = await bytes();
      expect(bloated).toBeGreaterThan(1_000_000);

      const outcome = (
        await compactStageLedgerWhenEmpty(scoped.db, { minBytes: 1 })
      )._unsafeUnwrap();

      expect(outcome.compacted).toBe(true);
      expect(await bytes()).toBeLessThan(bloated);
    } finally {
      await scoped.db.destroy();
    }
  });

  it('skips a ledger below the size floor without probing it', async () => {
    await churn('cuosmall', 50);

    const outcome = (
      await compactStageLedgerWhenEmpty(created.db, { minBytes: 1_000_000_000 })
    )._unsafeUnwrap();

    expect(outcome.compacted).toBe(false);
    expect(outcome.bytesBefore).toBeGreaterThan(0);
    expect(outcome.bytesBefore).toBeLessThan(1_000_000_000);
  });
});

/**
 * The reset is scheduled from the product's task-completion path, so the wiring
 * itself needs an always-run proof: completing a task with an empty, bloated
 * ledger must shrink its file (and a ledger a scope still holds must survive).
 */
describe('stage ledger compaction wiring (pglite)', () => {
  const BASE_ID = `bse${'a'.repeat(16)}`;
  const SPACE_ID = `spc${'s'.repeat(16)}`;
  const SEED_TABLE_ID = `tbl${'b'.repeat(16)}`;
  const FIELD_ID = `fld${'c'.repeat(16)}`;

  let created: PGliteTestDb;
  let db: Kysely<V1TeableDatabase>;

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

  const ledgerBytes = async (): Promise<number> => {
    const result = await sql<{ bytes: string }>`
      select pg_total_relation_size(${STAGE_LEDGER_TABLE}::text::regclass)::text as bytes
    `.execute(db);
    return Number(result.rows[0]?.bytes ?? 0);
  };

  /** A wave peak leaves megabytes behind; an emptied ledger must be far below it. */
  const WAVE_LEDGER_BYTES = 1 * 1024 * 1024;
  /** A reset ledger is a handful of pages (measured: 24 KiB). */
  const RESET_LEDGER_BYTES = 256 * 1024;

  const waitForBytesBelow = async (limit: number, timeoutMs = 5_000): Promise<number> => {
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

  const churn = async (scopeId: string, rows: number): Promise<void> => {
    await sql`
      insert into ${sql.table(STAGE_LEDGER_TABLE)} (scope_id, kind, table_id, record_id, seq)
      select ${scopeId}, 'excluded', 'tbl' || substr(md5(g::text), 1, 17),
             'rec' || substr(md5('w' || g::text || random()::text), 1, 17), 0
      from generate_series(1, ${rows}) g
    `.execute(db);
    await sql`delete from ${sql.table(STAGE_LEDGER_TABLE)} where scope_id = ${scopeId}`.execute(db);
  };

  /** One real completion on the product path that schedules housekeeping. */
  const completeOneTask = async (outbox: ComputedUpdateOutbox, planHash: string): Promise<void> => {
    const enqueued = await outbox.enqueueOrMerge(createTaskInput(planHash));
    if (enqueued.isErr()) throw new Error(enqueued.error.message);
    const claimed = await outbox.claimBatch({ workerId: 'it-worker', limit: 10 });
    if (claimed.isErr()) throw new Error(claimed.error.message);
    const done = await outbox.markDone(claimed.value[0]!);
    if (done.isErr()) throw new Error(done.error.message);
    expect(done.value).toBe(true);
  };

  beforeAll(async () => {
    created = await createPGliteDb();
    db = created.db;
    await created.pglite.exec(`
      CREATE TABLE ${STAGE_LEDGER_TABLE} (
        scope_id text NOT NULL,
        kind text NOT NULL,
        table_id text NOT NULL,
        record_id text NOT NULL,
        seq bigint NOT NULL DEFAULT 0,
        PRIMARY KEY (scope_id, kind, table_id, record_id)
      );
      CREATE INDEX computed_update_stage_ledger_scope_id_kind_seq_idx
        ON ${STAGE_LEDGER_TABLE} (scope_id, kind, seq);
      CREATE TABLE space (id text PRIMARY KEY, name text);
      CREATE TABLE base (id text PRIMARY KEY, space_id text NOT NULL, name text);
      CREATE TABLE space_data_db_binding (
        id text PRIMARY KEY, space_id text NOT NULL, mode text NOT NULL, state text NOT NULL
      );
      CREATE TABLE table_meta (
        id text PRIMARY KEY, base_id text NOT NULL, name text, deleted_time timestamptz
      );
      CREATE TABLE computed_update_outbox (
        id text PRIMARY KEY,
        base_id text NOT NULL,
        seed_table_id text NOT NULL,
        seed_record_ids jsonb,
        change_type text NOT NULL,
        steps jsonb,
        edges jsonb,
        status text NOT NULL,
        attempts integer NOT NULL DEFAULT 0,
        max_attempts integer NOT NULL DEFAULT 8,
        next_run_at timestamptz NOT NULL DEFAULT now(),
        locked_at timestamptz,
        locked_by text,
        last_error text,
        estimated_complexity integer NOT NULL DEFAULT 0,
        plan_hash text NOT NULL,
        dirty_stats jsonb,
        affected_table_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
        affected_field_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
        sync_max_level integer,
        run_id text NOT NULL,
        origin_run_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
        run_total_steps integer NOT NULL DEFAULT 0,
        run_completed_steps_before integer NOT NULL DEFAULT 0,
        source_changed_at timestamptz,
        stage_depth integer NOT NULL DEFAULT 0,
        predecessor_task_id text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX computed_update_outbox_pending_unique_idx
        ON computed_update_outbox (base_id, seed_table_id, plan_hash, change_type)
        WHERE status = 'pending';
      CREATE TABLE computed_update_outbox_seed (
        id text PRIMARY KEY, task_id text NOT NULL, table_id text NOT NULL, record_id text NOT NULL
      );
      CREATE UNIQUE INDEX computed_update_outbox_seed_task_id_table_id_record_id_key
        ON computed_update_outbox_seed (task_id, table_id, record_id);
      CREATE TABLE computed_update_pause_scope (
        id text PRIMARY KEY,
        scope_type text NOT NULL,
        scope_id text NOT NULL,
        paused_at timestamptz NOT NULL DEFAULT now(),
        paused_by text,
        resume_at timestamptz,
        reason text,
        write_policy text NOT NULL DEFAULT 'allow_bounded',
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by text
      );
      INSERT INTO space (id, name) VALUES ('${SPACE_ID}', 'Space');
      INSERT INTO base (id, space_id, name) VALUES ('${BASE_ID}', '${SPACE_ID}', 'Base');
      INSERT INTO table_meta (id, base_id, name, deleted_time)
        VALUES ('${SEED_TABLE_ID}', '${BASE_ID}', 'Seed', NULL);
    `);
  });

  afterAll(async () => created.db.destroy());

  beforeEach(async () => {
    await created.pglite.exec(`
      TRUNCATE ${STAGE_LEDGER_TABLE}, computed_update_outbox, computed_update_outbox_seed,
        computed_update_pause_scope, space_data_db_binding
    `);
  });

  const createOutbox = () =>
    new ComputedUpdateOutbox(
      db,
      {
        ...defaultComputedUpdateOutboxConfig,
        seedInlineLimit: 0,
        stageLedgerCompactionMinBytes: 1,
      },
      createLogger(),
      db
    );

  it('resets the file from a completed task when the ledger is empty', async () => {
    await churn('cuofinished', 20_000);
    const bloated = await ledgerBytes();
    expect(bloated).toBeGreaterThan(WAVE_LEDGER_BYTES);

    await completeOneTask(createOutbox(), 'plan-wiring');

    expect(await waitForBytesBelow(WAVE_LEDGER_BYTES)).toBeLessThan(RESET_LEDGER_BYTES);
  });

  it('leaves the file alone while a scope still holds the ledger, then resets once it can', async () => {
    await churn('cuoheld', 20_000);
    await sql`
      insert into ${sql.table(STAGE_LEDGER_TABLE)} (scope_id, kind, table_id, record_id, seq)
      values ('cuoheld', 'frontier', 'tblaaaaaaaaaaaaaaaaa', 'recaaaaaaaaaaaaaaaaa', 1)
    `.execute(db);
    const bloated = await ledgerBytes();
    expect(bloated).toBeGreaterThan(WAVE_LEDGER_BYTES);

    // While the scope holds rows the completion may not touch the file.
    await completeOneTask(createOutbox(), 'plan-wiring-held');
    await sleep(200);
    expect(await ledgerBytes()).toBeGreaterThan(WAVE_LEDGER_BYTES);
    const rows = await sql<{ count: number }>`
      select count(*)::int as count from ${sql.table(STAGE_LEDGER_TABLE)} where scope_id = 'cuoheld'
    `.execute(db);
    expect(Number(rows.rows[0]?.count ?? 0)).toBe(1);

    // Releasing the scope lets a later completion (fresh instance, fresh
    // interval) reclaim the file — the guard, not a missing hook, held it back.
    await sql`delete from ${sql.table(STAGE_LEDGER_TABLE)} where scope_id = 'cuoheld'`.execute(db);
    await completeOneTask(createOutbox(), 'plan-wiring-released');
    expect(await waitForBytesBelow(WAVE_LEDGER_BYTES)).toBeLessThan(RESET_LEDGER_BYTES);
  });
});
