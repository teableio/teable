import { PGlite } from '@electric-sql/pglite';
import { BaseId, FieldId, NoopHasher, RecordId, TableId, type ILogger } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Dialect, QueryResult } from 'kysely';
import {
  CompiledQuery,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
} from 'kysely';
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';

import { ComputedUpdateOutbox } from '../ComputedUpdateOutbox';
import { buildSeedTaskInput } from '../ComputedUpdateSeedPayload';
import { defaultComputedUpdateOutboxConfig } from '../IComputedUpdateOutbox';

const createLogger = (): ILogger => ({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  child: () => createLogger(),
  scope: () => createLogger(),
});

class PGliteDriver {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  async init() {}

  async acquireConnection() {
    return new PGliteConnection(this.#client);
  }

  async beginTransaction(connection: PGliteConnection) {
    await connection.executeQuery(CompiledQuery.raw('BEGIN'));
  }

  async commitTransaction(connection: PGliteConnection) {
    await connection.executeQuery(CompiledQuery.raw('COMMIT'));
  }

  async rollbackTransaction(connection: PGliteConnection) {
    await connection.executeQuery(CompiledQuery.raw('ROLLBACK'));
  }

  async releaseConnection() {}

  async destroy() {}
}

class PGliteConnection {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  async executeQuery<O>(compiledQuery: CompiledQuery): Promise<QueryResult<O>> {
    const result = await this.#client.query<O>(compiledQuery.sql, [...compiledQuery.parameters]);
    return {
      numAffectedRows: result.affectedRows ? BigInt(result.affectedRows) : undefined,
      rows: result.rows as O[],
    };
  }

  async *streamQuery(): AsyncGenerator<never, void, unknown> {
    yield undefined as never;
    throw new Error('Streaming not supported');
  }
}

class PGliteDialect implements Dialect {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  createDriver() {
    return new PGliteDriver(this.#client);
  }

  createAdapter() {
    return new PostgresAdapter();
  }

  createIntrospector(db: Kysely<unknown>) {
    return new PostgresIntrospector(db);
  }

  createQueryCompiler() {
    return new PostgresQueryCompiler();
  }
}

const createRecordId = (index: number): RecordId =>
  RecordId.create(`rec${String(index).padStart(16, '0')}`)._unsafeUnwrap();

const createTestOutbox = (db: Kysely<V1TeableDatabase>) =>
  new ComputedUpdateOutbox(
    db,
    {
      ...defaultComputedUpdateOutboxConfig,
      seedInlineLimit: 0,
      processingLeaseMs: 1000,
      heartbeatIntervalMs: 250,
      reclaimBatchSize: 10,
    },
    createLogger()
  );

const insertOutboxRow = async (
  db: Kysely<V1TeableDatabase>,
  params: {
    id: string;
    status: 'pending' | 'processing';
    lockedAt?: Date | null;
    lockedBy?: string | null;
    nextRunAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
  }
) => {
  const now = params.createdAt ?? new Date('2026-01-05T12:00:00Z');
  await db
    .insertInto('computed_update_outbox')
    .values({
      id: params.id,
      base_id: `bse${'a'.repeat(16)}`,
      seed_table_id: `tbl${'b'.repeat(16)}`,
      seed_record_ids: JSON.stringify([{ tableId: `tbl${'b'.repeat(16)}`, recordIds: ['rec1'] }]),
      change_type: 'update',
      steps: JSON.stringify([]),
      edges: JSON.stringify([]),
      status: params.status,
      attempts: 0,
      max_attempts: 8,
      next_run_at: params.nextRunAt ?? now,
      locked_at: params.lockedAt ?? null,
      locked_by: params.lockedBy ?? null,
      last_error: null,
      estimated_complexity: 1,
      plan_hash: `hash-${params.id}`,
      dirty_stats: JSON.stringify([]),
      affected_table_ids: [`tbl${'b'.repeat(16)}`],
      affected_field_ids: [`fld${'c'.repeat(16)}`],
      sync_max_level: 0,
      run_id: `run-${params.id}`,
      origin_run_ids: [],
      run_total_steps: 1,
      run_completed_steps_before: 0,
      created_at: params.createdAt ?? now,
      updated_at: params.updatedAt ?? now,
    })
    .execute();
};

describe('ComputedUpdateOutbox deadlock (pglite integration)', () => {
  let pglite: PGlite;
  let db: Kysely<V1TeableDatabase>;

  beforeAll(async () => {
    pglite = await PGlite.create();
    db = new Kysely<V1TeableDatabase>({
      dialect: new PGliteDialect(pglite),
    });

    await db.schema
      .createTable('computed_update_outbox')
      .ifNotExists()
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
      .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .execute();

    await db.schema
      .createTable('computed_update_outbox_seed')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('task_id', 'text', (col) => col.notNull())
      .addColumn('table_id', 'text', (col) => col.notNull())
      .addColumn('record_id', 'text', (col) => col.notNull())
      .execute();

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "computed_update_outbox_seed_task_id_table_id_record_id_key"
      ON "computed_update_outbox_seed"("task_id", "table_id", "record_id")
    `.execute(db);

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "computed_update_outbox_pending_unique_idx"
      ON "computed_update_outbox"("base_id", "seed_table_id", "plan_hash", "change_type")
      WHERE "status" = 'pending'
    `.execute(db);
  });

  beforeEach(async () => {
    await db.deleteFrom('computed_update_outbox_seed').execute();
    await db.deleteFrom('computed_update_outbox').execute();
  });

  afterAll(async () => {
    await db.destroy();
    await pglite.close();
  });

  it('enqueues concurrent seed tasks without deadlock and merges into one pending row', async () => {
    const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
    const seedTableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
    const changedFieldId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
    const hasher = new NoopHasher();

    const outbox = createTestOutbox(db);

    const seedRecordPool = Array.from({ length: 40 }, (_, index) => createRecordId(index + 1));
    const tasks = Array.from({ length: 12 }, (_, taskIndex) => {
      const seedRecordIds = seedRecordPool.slice(taskIndex, taskIndex + 15);
      return buildSeedTaskInput({
        baseId,
        seedTableId,
        seedRecordIds,
        extraSeedRecords: [],
        changedFieldIds: [changedFieldId],
        changeType: 'insert',
        hasher,
        runId: `run-${taskIndex}`,
      });
    });

    const results = await Promise.all(tasks.map((task) => outbox.enqueueSeedTask(task)));

    const errors = results.flatMap((result) => (result.isErr() ? [result.error.message] : []));
    expect(errors).toEqual([]);

    const outboxRows = await db.selectFrom('computed_update_outbox').selectAll().execute();
    expect(outboxRows.length).toBe(1);

    const seedRows = await db
      .selectFrom('computed_update_outbox_seed')
      .select(['table_id', 'record_id'])
      .execute();

    const expectedKeys = new Set(
      tasks
        .flatMap((task) => task.seedRecordIds)
        .map((recordId) => `${seedTableId.toString()}|${recordId}`)
    );
    const actualKeys = new Set(seedRows.map((row) => `${row.table_id}|${row.record_id}`));

    expect(actualKeys.size).toBe(expectedKeys.size);
  });

  it('reclaims stale processing tasks after the lease expires', async () => {
    const now = new Date('2026-01-05T12:00:10Z');
    await insertOutboxRow(db, {
      id: 'cuo-stale-1',
      status: 'processing',
      lockedAt: new Date(now.getTime() - 1500),
      lockedBy: 'worker-old:cuc_old',
      createdAt: new Date(now.getTime() - 10_000),
      updatedAt: new Date(now.getTime() - 1500),
    });

    const outbox = createTestOutbox(db);
    const claimed = await outbox.claimBatch({
      workerId: 'worker-new',
      limit: 10,
      now,
    });

    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap()).toHaveLength(1);
    expect(claimed._unsafeUnwrap()[0].id).toBe('cuo-stale-1');
    expect(claimed._unsafeUnwrap()[0].lockedBy).toContain('worker-new:');

    const row = await db
      .selectFrom('computed_update_outbox')
      .select(['status', 'locked_at', 'locked_by'])
      .where('id', '=', 'cuo-stale-1')
      .executeTakeFirstOrThrow();

    expect(row.status).toBe('processing');
    expect(String(row.locked_by)).toContain('worker-new:');
    expect(new Date(String(row.locked_at)).toISOString()).toBe(now.toISOString());
  });

  it('does not reclaim processing tasks whose lease was renewed', async () => {
    const createdAt = new Date('2026-01-05T12:00:00Z');
    const renewedAt = new Date('2026-01-05T12:00:00.800Z');
    const claimAt = new Date('2026-01-05T12:00:01.700Z');

    await insertOutboxRow(db, {
      id: 'cuo-renew-1',
      status: 'processing',
      lockedAt: createdAt,
      lockedBy: 'worker-old:cuc_old',
      createdAt,
      updatedAt: createdAt,
    });

    const outbox = createTestOutbox(db);
    const renewed = await outbox.renewLease({
      taskIds: ['cuo-renew-1'],
      leaseOwner: 'worker-old:cuc_old',
      now: renewedAt,
    });
    expect(renewed.isOk()).toBe(true);
    expect(renewed._unsafeUnwrap()).toEqual(['cuo-renew-1']);

    const claimed = await outbox.claimBatch({
      workerId: 'worker-new',
      limit: 10,
      now: claimAt,
    });

    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap()).toHaveLength(0);
  });

  it('a second worker does not reclaim the same task after the first reclaim commits', async () => {
    const now = new Date('2026-01-05T12:00:10Z');
    await insertOutboxRow(db, {
      id: 'cuo-stale-race',
      status: 'processing',
      lockedAt: new Date(now.getTime() - 1500),
      lockedBy: 'worker-old:cuc_old',
      createdAt: new Date(now.getTime() - 10_000),
      updatedAt: new Date(now.getTime() - 1500),
    });

    const outbox1 = createTestOutbox(db);
    const outbox2 = createTestOutbox(db);
    const result1 = await outbox1.claimBatch({ workerId: 'worker-a', limit: 1, now });
    const result2 = await outbox2.claimBatch({ workerId: 'worker-b', limit: 1, now });

    expect(result1.isOk()).toBe(true);
    expect(result2.isOk()).toBe(true);
    expect(result1._unsafeUnwrap()).toHaveLength(1);
    expect(result2._unsafeUnwrap()).toHaveLength(0);
  });
});
