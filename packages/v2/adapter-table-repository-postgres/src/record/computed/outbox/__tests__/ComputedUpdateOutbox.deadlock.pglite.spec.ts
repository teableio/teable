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
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

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

  afterAll(async () => {
    await db.destroy();
    await pglite.close();
  });

  it('enqueues concurrent seed tasks without deadlock and merges into one pending row', async () => {
    const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
    const seedTableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
    const changedFieldId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
    const hasher = new NoopHasher();

    const outbox = new ComputedUpdateOutbox(
      db,
      {
        ...defaultComputedUpdateOutboxConfig,
        seedInlineLimit: 0,
      },
      createLogger()
    );

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
});
