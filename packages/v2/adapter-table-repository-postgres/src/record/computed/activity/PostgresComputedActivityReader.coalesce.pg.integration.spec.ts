import { setTimeout as sleep } from 'node:timers/promises';
import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import { getPostgresTransaction } from '@teable/v2-adapter-db-postgres-shared';
import { NoopLogger, ok } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DynamicDB } from '../../query-builder';
import { ComputedActivityProjector } from './ComputedActivityProjector';
import { PostgresComputedActivityReader } from './PostgresComputedActivityReader';

// Opt-in real Postgres coverage; ordinary unit/PGlite runs never start Docker.
const describePg = process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1' ? describe : describe.skip;
const BASE_ID = `bse${'a'.repeat(16)}`;
const SPACE_ID = `spc${'e'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;
const FIELD_A = `fld${'c'.repeat(16)}`;
const FIELD_B = `fld${'d'.repeat(16)}`;
// Exactly what GetComputeActivityHandler asks for on the poll path.
const HTTP_POLL = { budgetMs: 2_000, includePauseDiagnostics: true } as const;

describePg('PostgresComputedActivityReader poll coalescing (Postgres)', () => {
  let stopPostgres: (() => Promise<unknown>) | undefined;
  let db: Kysely<V1TeableDatabase>;

  // Every uncached budgeted read opens exactly one transaction, so the number of
  // transactions started during a block counts database reads.
  const readsDuring = async (run: () => Promise<unknown>): Promise<number> => {
    const spy = vi.spyOn(db, 'transaction');
    try {
      await run();
      return spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
  };

  const buildReader = (): PostgresComputedActivityReader => {
    const projector = new ComputedActivityProjector(db, new NoopLogger());
    return new PostgresComputedActivityReader(db, projector);
  };

  const withCacheTtl = (ttlMs: number | undefined, build: () => PostgresComputedActivityReader) => {
    const previous = process.env.COMPUTED_ACTIVITY_READ_CACHE_MS;
    if (ttlMs === undefined) delete process.env.COMPUTED_ACTIVITY_READ_CACHE_MS;
    else process.env.COMPUTED_ACTIVITY_READ_CACHE_MS = String(ttlMs);
    try {
      return build();
    } finally {
      if (previous === undefined) delete process.env.COMPUTED_ACTIVITY_READ_CACHE_MS;
      else process.env.COMPUTED_ACTIVITY_READ_CACHE_MS = previous;
    }
  };

  beforeAll(async () => {
    const container = await new PostgreSqlContainer(
      process.env.TEABLE_V2_TEST_PG_IMAGE ?? 'postgres:16-alpine'
    ).start();
    stopPostgres = () => container.stop();
    const config = { pg: { connectionString: container.getConnectionUri(), pool: { max: 1 } } };
    db = await createV2PostgresDb<V1TeableDatabase>(config);

    await db.schema
      .createTable('computed_field_activity')
      .addColumn('field_id', 'text', (column) => column.primaryKey())
      .addColumn('table_id', 'text', (column) => column.notNull())
      .addColumn('base_id', 'text', (column) => column.notNull())
      .addColumn('status', 'text', (column) => column.notNull())
      .addColumn('active_task_count', 'integer', (column) => column.notNull().defaultTo(0))
      .addColumn('processing_task_count', 'integer', (column) => column.notNull().defaultTo(0))
      .addColumn('generation', 'bigint', (column) => column.notNull().defaultTo(0))
      .addColumn('estimated_complexity', 'bigint', (column) => column.notNull().defaultTo(0))
      .addColumn('estimated_dirty_records', 'bigint', (column) => column.notNull().defaultTo(0))
      .addColumn('has_all_target_records', 'boolean', (column) => column.notNull().defaultTo(false))
      .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
      .execute();

    await db.schema
      .createTable('computed_table_activity')
      .addColumn('table_id', 'text', (column) => column.primaryKey())
      .addColumn('base_id', 'text', (column) => column.notNull())
      .addColumn('status', 'text', (column) => column.notNull())
      .addColumn('calculating_field_count', 'integer', (column) => column.notNull().defaultTo(0))
      .addColumn('queued_field_count', 'integer', (column) => column.notNull().defaultTo(0))
      .addColumn('estimated_complexity', 'bigint', (column) => column.notNull().defaultTo(0))
      .addColumn('recent_completions', 'jsonb', (column) =>
        column.notNull().defaultTo(sql`'[]'::jsonb`)
      )
      .addColumn('generation', 'bigint', (column) => column.notNull().defaultTo(0))
      .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
      .execute();

    await db.schema
      .createTable('computed_update_pause_scope')
      .addColumn('id', 'text', (column) => column.primaryKey())
      .addColumn('scope_type', 'text', (column) => column.notNull())
      .addColumn('scope_id', 'text', (column) => column.notNull())
      .addColumn('paused_at', 'timestamptz', (column) => column.notNull())
      .addColumn('paused_by', 'text')
      .addColumn('resume_at', 'timestamptz')
      .addColumn('reason', 'text')
      .addColumn('write_policy', 'text', (column) => column.notNull().defaultTo('allow_bounded'))
      .execute();

    await db.schema
      .createTable('computed_task_field_ref')
      .addColumn('task_id', 'text', (column) => column.notNull())
      .addColumn('field_id', 'text', (column) => column.notNull())
      .addColumn('table_id', 'text', (column) => column.notNull())
      .addColumn('base_id', 'text', (column) => column.notNull())
      .addColumn('was_processing', 'boolean', (column) => column.notNull().defaultTo(false))
      .addColumn('created_at', 'timestamptz', (column) => column.notNull())
      .addPrimaryKeyConstraint('computed_task_field_ref_pkey', ['task_id', 'field_id'])
      .execute();

    await db.schema
      .createTable('computed_update_outbox')
      .addColumn('id', 'text', (column) => column.primaryKey())
      .addColumn('status', 'text', (column) => column.notNull().defaultTo('pending'))
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .execute();

    await db.schema
      .createTable('base')
      .addColumn('id', 'text', (column) => column.primaryKey())
      .addColumn('space_id', 'text', (column) => column.notNull())
      .execute();

    await db
      .insertInto('base' as never)
      .values({ id: BASE_ID, space_id: SPACE_ID } as never)
      .execute();

    const now = new Date();
    await sql`insert into computed_field_activity (field_id, table_id, base_id, status, updated_at)
      values (${FIELD_A}, ${TABLE_ID}, ${BASE_ID}, 'running', ${now}),
             (${FIELD_B}, ${TABLE_ID}, ${BASE_ID}, 'idle', ${now})`.execute(db);
    await sql`insert into computed_table_activity (table_id, base_id, status, calculating_field_count, updated_at)
      values (${TABLE_ID}, ${BASE_ID}, 'calculating', 1, ${now})`.execute(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await stopPostgres?.();
  });

  it('serves a repeat poll of the same table and scope without touching the database', async () => {
    const reader = withCacheTtl(undefined, buildReader);

    const first = await reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL);
    const cachedReads = await readsDuring(async () => {
      await reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL);
      await reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL);
    });

    expect(first.isOk()).toBe(true);
    expect(cachedReads).toBe(0); // both polls served from the cold read
    const repeated = await reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL);
    expect(repeated._unsafeUnwrap().fields.map((field) => field.fieldId)).toEqual(
      first._unsafeUnwrap().fields.map((field) => field.fieldId)
    );
  });

  it('collapses concurrent polls of one table into a single read', async () => {
    const reader = withCacheTtl(undefined, buildReader);

    const reads = await readsDuring(async () => {
      const results = await Promise.all([
        reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL),
        reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL),
        reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL),
        reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL),
      ]);
      for (const result of results) expect(result.isOk()).toBe(true);
    });

    expect(reads).toBe(1);
  });

  it('never answers a field scope from another scope entry', async () => {
    const reader = withCacheTtl(undefined, buildReader);
    const restrictedOptions = { ...HTTP_POLL, readableFieldIds: [FIELD_A] };

    const unrestricted = await reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL);
    const restrictedReads = await readsDuring(() =>
      reader.getByTableId(undefined, TABLE_ID, BASE_ID, restrictedOptions)
    );
    const restricted = await reader.getByTableId(undefined, TABLE_ID, BASE_ID, restrictedOptions);
    const repeatedRestrictedReads = await readsDuring(() =>
      reader.getByTableId(undefined, TABLE_ID, BASE_ID, restrictedOptions)
    );

    expect(unrestricted._unsafeUnwrap().fields).toHaveLength(2);
    expect(restricted._unsafeUnwrap().fields.map((field) => field.fieldId)).toEqual([FIELD_A]);
    expect(restrictedReads).toBe(1); // a different scope reads instead of reusing the entry
    expect(repeatedRestrictedReads).toBe(0);
  });

  it('keeps a deny-all scope out of the unrestricted entry', async () => {
    const reader = withCacheTtl(undefined, buildReader);
    const deniedOptions = { ...HTTP_POLL, readableFieldIds: [] };

    const unrestricted = await reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL);
    const deniedReads = await readsDuring(() =>
      reader.getByTableId(undefined, TABLE_ID, BASE_ID, deniedOptions)
    );
    const denied = await reader.getByTableId(undefined, TABLE_ID, BASE_ID, deniedOptions);
    const repeatedDeniedReads = await readsDuring(() =>
      reader.getByTableId(undefined, TABLE_ID, BASE_ID, deniedOptions)
    );

    expect(unrestricted._unsafeUnwrap().fields).toHaveLength(2);
    expect(denied._unsafeUnwrap().fields).toEqual([]);
    expect(deniedReads).toBe(1); // reading nothing is its own entry, never the unrestricted one
    expect(repeatedDeniedReads).toBe(0);
  });

  it('re-reads once the TTL expires', async () => {
    const reader = withCacheTtl(50, buildReader);

    await reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL);
    const cached = await readsDuring(() =>
      reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL)
    );
    await sleep(80);
    const expired = await readsDuring(() =>
      reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL)
    );

    expect(cached).toBe(0);
    expect(expired).toBe(1);
  });

  it('keeps per-request reads when the coalescer is disabled', async () => {
    const reader = withCacheTtl(0, buildReader);

    const reads = await readsDuring(async () => {
      await reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL);
      await reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL);
    });

    expect(reads).toBe(2);
  });

  it('does not reuse an entry across differing read options', async () => {
    const reader = withCacheTtl(undefined, buildReader);

    await reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL);
    const withoutFields = await readsDuring(() =>
      reader.getByTableId(undefined, TABLE_ID, BASE_ID, {
        budgetMs: HTTP_POLL.budgetMs,
        includeFields: false,
      })
    );

    expect(withoutFields).toBe(1);
  });

  it('re-reads a poll when the projection changed since the stored read', async () => {
    const reader = withCacheTtl(undefined, buildReader);
    await sql`update computed_field_activity set status = 'running', generation = generation + 1, updated_at = now()
      where field_id = ${FIELD_A}`.execute(db);
    const beforeChange = await reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL);
    expect(
      beforeChange._unsafeUnwrap().fields.find((field) => field.fieldId === FIELD_A)?.status
    ).toBe('running');

    let afterChange: typeof beforeChange | undefined;
    const reads = await readsDuring(async () => {
      // The flusher finishing the field is exactly the change the client is notified about.
      await sql`update computed_field_activity set status = 'idle', generation = generation + 1, updated_at = now()
        where field_id = ${FIELD_A}`.execute(db);
      afterChange = await reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL);
    });

    expect(reads).toBe(1); // a stored snapshot is never served past the projection it came from
    expect(
      afterChange?._unsafeUnwrap().fields.find((field) => field.fieldId === FIELD_A)?.status
    ).toBe('idle');
  });

  it('invalidates when a field row moves below the current maxima', async () => {
    const reader = withCacheTtl(undefined, buildReader);
    // FIELD_B dominates both maxima, so FIELD_A's change moves neither of them.
    await sql`update computed_field_activity set generation = 500, updated_at = now()
      where field_id = ${FIELD_B}`.execute(db);
    await sql`update computed_field_activity set status = 'running', generation = 1, updated_at = now() - interval '1 hour'
      where field_id = ${FIELD_A}`.execute(db);
    const before = await reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL);
    expect(before._unsafeUnwrap().fields.find((field) => field.fieldId === FIELD_A)?.status).toBe(
      'running'
    );

    let after: typeof before | undefined;
    const reads = await readsDuring(async () => {
      await sql`update computed_field_activity set status = 'idle', generation = 2, updated_at = now() - interval '1 hour'
        where field_id = ${FIELD_A}`.execute(db);
      after = await reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL);
    });

    expect(reads).toBe(1);
    expect(after?._unsafeUnwrap().fields.find((field) => field.fieldId === FIELD_A)?.status).toBe(
      'idle'
    );
  });

  it('invalidates when a field row is removed', async () => {
    const reader = withCacheTtl(undefined, buildReader);
    const extraField = `fld${'e'.repeat(16)}`;
    // FIELD_B holds both maxima and the extra row sits below them, so only a
    // row-set version can notice that the row disappeared.
    await sql`update computed_field_activity set generation = 500, updated_at = now()
      where field_id = ${FIELD_B}`.execute(db);
    await sql`insert into computed_field_activity (field_id, table_id, base_id, status, generation, updated_at)
      values (${extraField}, ${TABLE_ID}, ${BASE_ID}, 'idle', 0, now() - interval '2 hours')`.execute(
      db
    );
    const before = await reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL);
    expect(before._unsafeUnwrap().fields.map((field) => field.fieldId)).toContain(extraField);

    let after: typeof before | undefined;
    const reads = await readsDuring(async () => {
      await sql`delete from computed_field_activity where field_id = ${extraField}`.execute(db);
      after = await reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL);
    });

    expect(reads).toBe(1);
    expect(after?._unsafeUnwrap().fields.map((field) => field.fieldId)).not.toContain(extraField);
  });

  it('returns post-write rows when a projection write lands while the poll reads', async () => {
    const projector = new ComputedActivityProjector(db, new NoopLogger());
    const reader = new PostgresComputedActivityReader(db, projector);
    await sql`update computed_field_activity set status = 'running', generation = generation + 1, updated_at = now()
      where field_id = ${FIELD_A}`.execute(db);
    // A ref without an outbox row is drift, so the heal path reconciles for real.
    await sql`insert into computed_task_field_ref (task_id, field_id, table_id, base_id, was_processing, created_at)
      values ('coalesce-race-reference', ${FIELD_A}, ${TABLE_ID}, ${BASE_ID}, true, now())`.execute(
      db
    );

    const slow = vi
      .spyOn(projector, 'reconcileTable')
      .mockImplementation(async (_params, context) => {
        const trx = getPostgresTransaction<DynamicDB>(context);
        if (trx) await sql`select pg_sleep(0.4)`.execute(trx);
        return ok(null);
      });
    try {
      const racing = reader.getByTableId(undefined, TABLE_ID, BASE_ID, {
        budgetMs: 5_000,
        heal: true,
      });
      await sleep(120);
      await sql`update computed_field_activity set status = 'idle', generation = generation + 1, updated_at = now()
        where field_id = ${FIELD_A}`.execute(db);
      await sql`delete from computed_task_field_ref where task_id = 'coalesce-race-reference'`.execute(
        db
      );

      // The response that raced the write is re-read, so it cannot predate a write
      // its own caller — or a coalesced joiner — may already have been notified of.
      const raced = await racing;
      expect(raced._unsafeUnwrap().fields.find((field) => field.fieldId === FIELD_A)?.status).toBe(
        'idle'
      );
    } finally {
      slow.mockRestore();
    }
  });

  it('never stores a snapshot read before a projection write it missed', async () => {
    const projector = new ComputedActivityProjector(db, new NoopLogger());
    const reader = new PostgresComputedActivityReader(db, projector);
    await sql`update computed_field_activity set status = 'running', generation = generation + 1, updated_at = now()
      where field_id = ${FIELD_A}`.execute(db);
    // A ref without an outbox row is drift, so the heal path reconciles for real.
    await sql`insert into computed_task_field_ref (task_id, field_id, table_id, base_id, was_processing, created_at)
      values ('coalesce-race-reference', ${FIELD_A}, ${TABLE_ID}, ${BASE_ID}, true, now())`.execute(
      db
    );

    const slow = vi
      .spyOn(projector, 'reconcileTable')
      .mockImplementation(async (_params, context) => {
        const trx = getPostgresTransaction<DynamicDB>(context);
        if (trx) await sql`select pg_sleep(0.4)`.execute(trx);
        return ok(null);
      });
    try {
      const racing = reader.getByTableId(undefined, TABLE_ID, BASE_ID, {
        budgetMs: 5_000,
        heal: true,
      });
      await sleep(120);
      // The write lands while the racing read is still in flight.
      await sql`update computed_field_activity set status = 'idle', generation = generation + 1, updated_at = now()
        where field_id = ${FIELD_A}`.execute(db);
      expect((await racing).isOk()).toBe(true);
      await sql`delete from computed_task_field_ref where task_id = 'coalesce-race-reference'`.execute(
        db
      );

      // Whatever the racing request returned, the next poll must not be served the
      // pre-write rows: only a version that brackets the snapshot may label an entry.
      const next = await reader.getByTableId(undefined, TABLE_ID, BASE_ID, {
        budgetMs: 5_000,
        heal: true,
      });
      expect(next._unsafeUnwrap().fields.find((field) => field.fieldId === FIELD_A)?.status).toBe(
        'idle'
      );
    } finally {
      slow.mockRestore();
    }
  });

  it('rejects a non-positive budget whether or not a read is stored', async () => {
    const reader = withCacheTtl(undefined, buildReader);
    const rejected = { ...HTTP_POLL, budgetMs: 0 };

    expect((await reader.getByTableId(undefined, TABLE_ID, BASE_ID, HTTP_POLL)).isOk()).toBe(true);
    expect((await reader.getByTableId(undefined, TABLE_ID, BASE_ID, rejected)).isErr()).toBe(true);
    expect((await reader.getByTableId(undefined, TABLE_ID, BASE_ID, rejected)).isErr()).toBe(true);
    expect(
      (
        await withCacheTtl(undefined, buildReader).getByTableId(
          undefined,
          TABLE_ID,
          BASE_ID,
          rejected
        )
      ).isErr()
    ).toBe(true);
  });

  it('bounds a caller waiting on another caller read by its own budget', async () => {
    const projector = new ComputedActivityProjector(db, new NoopLogger());
    const reader = new PostgresComputedActivityReader(db, projector);
    // A ref without an outbox row is drift, so the heal path reconciles for real.
    await sql`insert into computed_task_field_ref (task_id, field_id, table_id, base_id, was_processing, created_at)
      values ('coalesce-budget-reference', ${FIELD_A}, ${TABLE_ID}, ${BASE_ID}, true, now())`.execute(
      db
    );

    const slow = vi
      .spyOn(projector, 'reconcileTable')
      .mockImplementation(async (_params, context) => {
        const trx = getPostgresTransaction<DynamicDB>(context);
        if (trx) await sql`select pg_sleep(0.6)`.execute(trx);
        return ok(null);
      });
    try {
      const longBudget = reader.getByTableId(undefined, TABLE_ID, BASE_ID, {
        budgetMs: 5_000,
        heal: true,
      });
      await sleep(50);
      const startedAt = performance.now();
      const shortBudget = await reader.getByTableId(undefined, TABLE_ID, BASE_ID, {
        budgetMs: 60,
        heal: true,
      });
      const waitedMs = performance.now() - startedAt;

      expect(shortBudget.isErr()).toBe(true); // the shared read outlives this caller's budget
      expect(waitedMs).toBeLessThan(500);
      expect((await longBudget).isOk()).toBe(true);
    } finally {
      slow.mockRestore();
    }
  });
});
