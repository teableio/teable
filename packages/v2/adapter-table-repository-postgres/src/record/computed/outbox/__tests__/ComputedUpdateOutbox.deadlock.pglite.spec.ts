import { PGlite } from '@electric-sql/pglite';
import { PostgresUnitOfWorkTransaction } from '@teable/v2-adapter-db-postgres-shared';
import { BaseId, FieldId, NoopHasher, RecordId, TableId, type ILogger } from '@teable/v2-core';
import { computedReliabilitySchemaSql } from '@teable/v2-postgres-schema';
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
import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { DynamicDB } from '../../../query-builder';

import { ComputedUpdatePauseRegistry } from '../../pause/ComputedUpdatePauseRegistry';
import { PostgresComputedReliabilityStore } from '../../reliability/PostgresComputedReliabilityStore';
import type { ComputedOutboxWakeup, IComputedOutboxWakeupPublisher } from '../ComputedOutboxWakeup';
import { ComputedUpdateOutbox } from '../ComputedUpdateOutbox';
import type { ComputedUpdateOutboxTaskInput } from '../ComputedUpdateOutboxPayload';
import { buildSeedTaskInput } from '../ComputedUpdateSeedPayload';
import {
  defaultComputedUpdateOutboxConfig,
  type ComputedUpdateOutboxConfig,
  type SeedOutboxItem,
} from '../IComputedUpdateOutbox';

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

const createTestOutbox = (
  db: Kysely<V1TeableDatabase>,
  wakeupPublisher?: IComputedOutboxWakeupPublisher,
  config?: Partial<ComputedUpdateOutboxConfig>
) =>
  new ComputedUpdateOutbox(
    db,
    {
      ...defaultComputedUpdateOutboxConfig,
      seedInlineLimit: 0,
      processingLeaseMs: 1000,
      heartbeatIntervalMs: 250,
      reclaimBatchSize: 10,
      ...config,
    },
    createLogger(),
    db,
    wakeupPublisher
  );

class RecordingWakeupPublisher implements IComputedOutboxWakeupPublisher {
  readonly wakeups: ComputedOutboxWakeup[] = [];

  async publish(wakeup: ComputedOutboxWakeup) {
    this.wakeups.push(wakeup);
    return { status: 'accepted' as const };
  }
}

class ThrowingWakeupPublisher implements IComputedOutboxWakeupPublisher {
  async publish(): Promise<never> {
    throw new Error('broker unavailable');
  }
}

const createPauseRegistry = (db: Kysely<V1TeableDatabase>) =>
  new ComputedUpdatePauseRegistry(db, createLogger());

const PRIMARY_SPACE_ID = `spc${'s'.repeat(16)}`;
const PRIMARY_BASE_ID = `bse${'a'.repeat(16)}`;
const PRIMARY_SEED_TABLE_ID = `tbl${'b'.repeat(16)}`;
const PRIMARY_TARGET_TABLE_ID = `tbl${'d'.repeat(16)}`;
const SECONDARY_SPACE_ID = `spc${'t'.repeat(16)}`;
const SECONDARY_BASE_ID = `bse${'e'.repeat(16)}`;
const SECONDARY_SEED_TABLE_ID = `tbl${'f'.repeat(16)}`;
const SECONDARY_TARGET_TABLE_ID = `tbl${'g'.repeat(16)}`;

const insertOutboxRow = async (
  db: Kysely<V1TeableDatabase>,
  params: {
    id: string;
    baseId?: string;
    seedTableId?: string;
    affectedTableIds?: string[];
    status: 'pending' | 'processing';
    attempts?: number;
    maxAttempts?: number;
    lockedAt?: Date | null;
    lockedBy?: string | null;
    nextRunAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
    estimatedComplexity?: number;
    planHash?: string;
    rowChangeType?: string;
    seedRecordIds?: string[];
    affectedFieldIds?: string[];
    dirtyStats?: unknown;
  }
) => {
  const now = params.createdAt ?? new Date('2026-01-05T12:00:00Z');
  const seedTableId = params.seedTableId ?? PRIMARY_SEED_TABLE_ID;
  await db
    .insertInto('computed_update_outbox')
    .values({
      id: params.id,
      base_id: params.baseId ?? PRIMARY_BASE_ID,
      seed_table_id: seedTableId,
      seed_record_ids: JSON.stringify([
        {
          tableId: seedTableId,
          recordIds: params.seedRecordIds ?? ['rec1'],
        },
      ]),
      change_type: params.rowChangeType ?? 'update',
      steps: JSON.stringify([]),
      edges: JSON.stringify([]),
      status: params.status,
      attempts: params.attempts ?? 0,
      max_attempts: params.maxAttempts ?? 8,
      next_run_at: params.nextRunAt ?? now,
      locked_at: params.lockedAt ?? null,
      locked_by: params.lockedBy ?? null,
      last_error: null,
      estimated_complexity: params.estimatedComplexity ?? 1,
      plan_hash: params.planHash ?? `hash-${params.id}`,
      dirty_stats: JSON.stringify(params.dirtyStats ?? []),
      affected_table_ids: params.affectedTableIds ?? [params.seedTableId ?? PRIMARY_SEED_TABLE_ID],
      affected_field_ids: params.affectedFieldIds ?? [`fld${'c'.repeat(16)}`],
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

const readTaskNextRunAt = async (db: Kysely<V1TeableDatabase>, taskId: string): Promise<Date> => {
  const row = await db
    .selectFrom('computed_update_outbox')
    .select('next_run_at')
    .where('id', '=', taskId)
    .executeTakeFirstOrThrow();
  return new Date(row.next_run_at as unknown as Date | string);
};

const insertDeadLetterRow = async (
  db: Kysely<V1TeableDatabase>,
  params: {
    id: string;
    baseId?: string;
    seedTableId?: string;
    lastError?: string;
  }
) => {
  const now = new Date('2026-01-05T12:00:00Z');
  const seedTableId = params.seedTableId ?? PRIMARY_SEED_TABLE_ID;
  await db
    .insertInto('computed_update_dead_letter')
    .values({
      id: params.id,
      base_id: params.baseId ?? PRIMARY_BASE_ID,
      seed_table_id: seedTableId,
      seed_record_ids: JSON.stringify([{ tableId: seedTableId, recordIds: ['rec1'] }]),
      change_type: 'update',
      steps: JSON.stringify([]),
      edges: JSON.stringify([]),
      status: 'dead',
      attempts: 8,
      max_attempts: 8,
      next_run_at: now,
      locked_at: null,
      locked_by: null,
      last_error: params.lastError ?? 'error: canceling statement due to statement timeout',
      estimated_complexity: 1,
      plan_hash: `hash-${params.id}`,
      dirty_stats: JSON.stringify([]),
      affected_table_ids: [seedTableId],
      affected_field_ids: [`fld${'c'.repeat(16)}`],
      sync_max_level: 0,
      run_id: `run-${params.id}`,
      origin_run_ids: [],
      run_total_steps: 1,
      run_completed_steps_before: 0,
      trace_data: null,
      failed_at: now,
      created_at: now,
      updated_at: now,
    })
    .execute();
};

const insertMetadata = async (db: Kysely<V1TeableDatabase>) => {
  await db
    .insertInto('space')
    .values([
      { id: PRIMARY_SPACE_ID, name: 'Primary Space' },
      { id: SECONDARY_SPACE_ID, name: 'Secondary Space' },
    ])
    .execute();

  await db
    .insertInto('base')
    .values([
      { id: PRIMARY_BASE_ID, space_id: PRIMARY_SPACE_ID, name: 'Primary Base' },
      { id: SECONDARY_BASE_ID, space_id: SECONDARY_SPACE_ID, name: 'Secondary Base' },
    ])
    .execute();

  await db
    .insertInto('table_meta')
    .values([
      {
        id: PRIMARY_SEED_TABLE_ID,
        base_id: PRIMARY_BASE_ID,
        name: 'Primary Seed',
        deleted_time: null,
      },
      {
        id: PRIMARY_TARGET_TABLE_ID,
        base_id: PRIMARY_BASE_ID,
        name: 'Primary Target',
        deleted_time: null,
      },
      {
        id: SECONDARY_SEED_TABLE_ID,
        base_id: SECONDARY_BASE_ID,
        name: 'Secondary Seed',
        deleted_time: null,
      },
      {
        id: SECONDARY_TARGET_TABLE_ID,
        base_id: SECONDARY_BASE_ID,
        name: 'Secondary Target',
        deleted_time: null,
      },
    ])
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
      .createTable('space')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('name', 'text')
      .execute();

    await db.schema
      .createTable('base')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('space_id', 'text', (col) => col.notNull())
      .addColumn('name', 'text')
      .execute();

    await db.schema
      .createTable('space_data_db_binding')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('space_id', 'text', (col) => col.notNull())
      .addColumn('mode', 'text', (col) => col.notNull())
      .addColumn('state', 'text', (col) => col.notNull())
      .execute();

    await db.schema
      .createTable('table_meta')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('base_id', 'text', (col) => col.notNull())
      .addColumn('name', 'text')
      .addColumn('deleted_time', 'timestamptz')
      .execute();

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
      .addColumn('source_changed_at', 'timestamptz')
      .addColumn('stage_depth', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('predecessor_task_id', 'text')
      .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .execute();

    await db.schema
      .createTable('computed_update_dead_letter')
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
      .addColumn('source_changed_at', 'timestamptz')
      .addColumn('stage_depth', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('predecessor_task_id', 'text')
      .addColumn('trace_data', sql`jsonb`)
      .addColumn('failed_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
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
      CREATE UNIQUE INDEX IF NOT EXISTS "computed_update_outbox_pending_unique_idx"
      ON "computed_update_outbox"("base_id", "seed_table_id", "plan_hash", "change_type")
      WHERE "status" = 'pending'
    `.execute(db);

    await db.schema
      .createTable('computed_update_pause_scope')
      .ifNotExists()
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
      CREATE UNIQUE INDEX IF NOT EXISTS "computed_update_pause_scope_scope_type_scope_id_key"
      ON "computed_update_pause_scope"("scope_type", "scope_id")
    `.execute(db);

    await db.schema
      .createTable('computed_update_run_history')
      .ifNotExists()
      .addColumn('task_id', 'text', (col) => col.primaryKey())
      .addColumn('base_id', 'text', (col) => col.notNull())
      .addColumn('seed_table_id', 'text', (col) => col.notNull())
      .addColumn('change_type', 'text', (col) => col.notNull())
      .addColumn('run_id', 'text', (col) => col.notNull())
      .addColumn('origin_run_ids', sql`text[]`, (col) =>
        col.notNull().defaultTo(sql`ARRAY[]::text[]`)
      )
      .addColumn('steps', sql`jsonb`)
      .addColumn('edges', sql`jsonb`)
      .addColumn('affected_table_ids', sql`text[]`, (col) =>
        col.notNull().defaultTo(sql`ARRAY[]::text[]`)
      )
      .addColumn('affected_field_ids', sql`text[]`, (col) =>
        col.notNull().defaultTo(sql`ARRAY[]::text[]`)
      )
      .addColumn('source_field_ids', sql`text[]`, (col) =>
        col.notNull().defaultTo(sql`ARRAY[]::text[]`)
      )
      .addColumn('seed_record_count', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('stage_depth', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('predecessor_task_id', 'text')
      .addColumn('run_total_steps', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('run_completed_steps_before', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('sync_max_level', 'integer')
      .addColumn('estimated_complexity', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('outcome', 'text', (col) => col.notNull())
      .addColumn('source_changed_at', 'timestamptz')
      .addColumn('enqueued_at', 'timestamptz', (col) => col.notNull())
      .addColumn('started_at', 'timestamptz')
      .addColumn('completed_at', 'timestamptz', (col) => col.notNull())
      .addColumn('duration_ms', 'integer', (col) => col.notNull().defaultTo(0))
      .execute();
  });

  beforeEach(async () => {
    await sql`DELETE FROM "computed_update_run_history"`.execute(db);
    await db.deleteFrom('computed_update_pause_scope').execute();
    await db.deleteFrom('computed_update_outbox_seed').execute();
    await db.deleteFrom('computed_update_dead_letter').execute();
    await db.deleteFrom('computed_update_outbox').execute();
    await db.deleteFrom('space_data_db_binding').execute();
    await db.deleteFrom('table_meta').execute();
    await db.deleteFrom('base').execute();
    await db.deleteFrom('space').execute();
    await insertMetadata(db);
  });

  afterAll(async () => {
    await db.destroy();
    await pglite.close();
  });

  it('does not claim a task by id before next_run_at', async () => {
    const now = new Date('2026-01-05T12:00:00Z');
    await insertOutboxRow(db, {
      id: 'cuo-future-by-id',
      status: 'pending',
      nextRunAt: new Date(now.getTime() + 60_000),
    });

    const outbox = createTestOutbox(db);
    const claimed = await outbox.claimById({
      taskId: 'cuo-future-by-id',
      workerId: 'queue-worker',
      now,
    });

    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap()).toBeNull();
  });

  it('claims a due pending task by id', async () => {
    const now = new Date('2026-01-05T12:00:00Z');
    await insertOutboxRow(db, {
      id: 'cuo-due-by-id',
      status: 'pending',
      nextRunAt: now,
    });

    const outbox = createTestOutbox(db);
    const claimed = await outbox.claimById({
      taskId: 'cuo-due-by-id',
      workerId: 'queue-worker',
      now,
    });

    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap()?.id).toBe('cuo-due-by-id');
  });

  it('fences out tasks whose space is bound to an external data database', async () => {
    const now = new Date('2026-01-05T12:00:00Z');
    await db
      .insertInto('space_data_db_binding')
      .values({ id: 'sdbforeign1', space_id: PRIMARY_SPACE_ID, mode: 'byodb', state: 'ready' })
      .execute();
    await insertOutboxRow(db, {
      id: 'cuo-foreign-bound',
      status: 'pending',
      baseId: PRIMARY_BASE_ID,
      nextRunAt: now,
    });
    await insertOutboxRow(db, {
      id: 'cuo-locally-bound',
      status: 'pending',
      baseId: SECONDARY_BASE_ID,
      seedTableId: SECONDARY_SEED_TABLE_ID,
      nextRunAt: now,
    });

    const outbox = createTestOutbox(db);
    const batch = await outbox.claimBatch({ workerId: 'queue-worker', limit: 10, now });
    expect(batch.isOk()).toBe(true);
    expect(batch._unsafeUnwrap().map((task) => task.id)).toEqual(['cuo-locally-bound']);

    const byId = await outbox.claimById({
      taskId: 'cuo-foreign-bound',
      workerId: 'queue-worker',
      now,
    });
    expect(byId.isOk()).toBe(true);
    expect(byId._unsafeUnwrap()).toBeNull();
  });

  it('still claims tasks whose space has a default-mode binding row', async () => {
    const now = new Date('2026-01-05T12:00:00Z');
    await db
      .insertInto('space_data_db_binding')
      .values({ id: 'sdbdefault1', space_id: PRIMARY_SPACE_ID, mode: 'default', state: 'ready' })
      .execute();
    await insertOutboxRow(db, {
      id: 'cuo-default-bound',
      status: 'pending',
      baseId: PRIMARY_BASE_ID,
      nextRunAt: now,
    });

    const outbox = createTestOutbox(db);
    const claimed = await outbox.claimById({
      taskId: 'cuo-default-bound',
      workerId: 'queue-worker',
      now,
    });
    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap()?.id).toBe('cuo-default-bound');
  });

  it('does not take over an active processing task by default', async () => {
    const now = new Date('2026-01-05T12:00:00Z');
    await insertOutboxRow(db, {
      id: 'cuo-active-by-id',
      status: 'processing',
      lockedAt: now,
      lockedBy: 'active-worker:cuc_active',
      updatedAt: now,
    });

    const outbox = createTestOutbox(db);
    const claimed = await outbox.claimById({
      taskId: 'cuo-active-by-id',
      workerId: 'queue-worker',
      now,
    });

    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap()).toBeNull();

    const row = await db
      .selectFrom('computed_update_outbox')
      .select(['locked_by', 'locked_at'])
      .where('id', '=', 'cuo-active-by-id')
      .executeTakeFirstOrThrow();
    expect(row.locked_by).toBe('active-worker:cuc_active');
    expect(row.locked_at).toEqual(now);
  });

  it('does not claim a paused task by id', async () => {
    await insertOutboxRow(db, {
      id: 'cuo-paused-by-id',
      status: 'pending',
      baseId: PRIMARY_BASE_ID,
    });
    const pauseRegistry = createPauseRegistry(db);
    await pauseRegistry.pauseScope({
      scopeType: 'base',
      scopeId: PRIMARY_BASE_ID,
      actor: 'tester',
    });

    const outbox = createTestOutbox(db);
    const claimed = await outbox.claimById({
      taskId: 'cuo-paused-by-id',
      workerId: 'queue-worker',
    });

    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap()).toBeNull();
  });

  it('does not let processing takeover bypass a paused scope', async () => {
    await insertOutboxRow(db, {
      id: 'cuo-paused-takeover',
      status: 'processing',
      baseId: PRIMARY_BASE_ID,
      lockedAt: new Date(Date.now() - 60_000),
      lockedBy: 'stale-worker:cuc_stale',
    });
    await createPauseRegistry(db).pauseScope({
      scopeType: 'base',
      scopeId: PRIMARY_BASE_ID,
      actor: 'tester',
    });

    const claimed = await createTestOutbox(db).claimById({
      taskId: 'cuo-paused-takeover',
      workerId: 'manual-replay',
      allowProcessingTakeover: true,
    });

    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap()).toBeNull();
  });

  it('does not reclaim a stale processing task while its base is paused', async () => {
    const now = new Date('2026-01-05T12:00:00Z');
    await insertOutboxRow(db, {
      id: 'cuo-stale-paused-by-id',
      status: 'processing',
      baseId: PRIMARY_BASE_ID,
      lockedAt: new Date(now.getTime() - 60_000),
      lockedBy: 'expired-worker:cuc_expired',
    });
    await createPauseRegistry(db).pauseScope({
      scopeType: 'base',
      scopeId: PRIMARY_BASE_ID,
      actor: 'tester',
    });

    const claimed = await createTestOutbox(db).claimById({
      taskId: 'cuo-stale-paused-by-id',
      workerId: 'queue-worker',
      now,
    });

    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap()).toBeNull();
  });

  it('does not reclaim a stale processing task paused by space in split data/meta mode', async () => {
    const now = new Date('2026-01-05T12:00:00Z');
    await insertOutboxRow(db, {
      id: 'cuo-stale-space-paused',
      status: 'processing',
      baseId: PRIMARY_BASE_ID,
      lockedAt: new Date(now.getTime() - 60_000),
      lockedBy: 'expired-worker:cuc_expired',
    });
    await createPauseRegistry(db).pauseScope({
      scopeType: 'space',
      scopeId: PRIMARY_SPACE_ID,
      actor: 'tester',
    });
    const outbox = new ComputedUpdateOutbox(
      db,
      { ...defaultComputedUpdateOutboxConfig, processingLeaseMs: 1000 },
      createLogger(),
      db.withSchema('public') as never
    );

    const claimed = await outbox.claimById({
      taskId: 'cuo-stale-space-paused',
      workerId: 'queue-worker',
      now,
    });

    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap()).toBeNull();
  });

  it('does not reclaim a stale processing task above the base concurrency limit', async () => {
    const now = new Date('2026-01-05T12:00:00Z');
    await insertOutboxRow(db, {
      id: 'cuo-active-concurrency',
      status: 'processing',
      baseId: PRIMARY_BASE_ID,
      seedTableId: SECONDARY_SEED_TABLE_ID,
      lockedAt: now,
      lockedBy: 'active-worker:cuc_active',
    });
    await insertOutboxRow(db, {
      id: 'cuo-stale-concurrency',
      status: 'processing',
      baseId: PRIMARY_BASE_ID,
      seedTableId: PRIMARY_SEED_TABLE_ID,
      lockedAt: new Date(now.getTime() - 60_000),
      lockedBy: 'expired-worker:cuc_expired',
    });
    const outbox = createTestOutbox(db, undefined, {
      maxConcurrentProcessingPerBase: 1,
      maxConcurrentProcessingPerSeedTable: 1,
    });

    const claimed = await outbox.claimById({
      taskId: 'cuo-stale-concurrency',
      workerId: 'queue-worker',
      now,
    });

    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap()).toBeNull();
  });

  it('enforces per-base concurrency across by-id claims', async () => {
    await insertOutboxRow(db, {
      id: 'cuo-concurrency-by-id-1',
      status: 'pending',
      baseId: PRIMARY_BASE_ID,
      seedTableId: PRIMARY_SEED_TABLE_ID,
    });
    await insertOutboxRow(db, {
      id: 'cuo-concurrency-by-id-2',
      status: 'pending',
      baseId: PRIMARY_BASE_ID,
      seedTableId: SECONDARY_SEED_TABLE_ID,
    });
    const outbox = createTestOutbox(db, undefined, {
      maxConcurrentProcessingPerBase: 1,
      maxConcurrentProcessingPerSeedTable: 1,
    });

    const claims = [
      await outbox.claimById({ taskId: 'cuo-concurrency-by-id-1', workerId: 'queue-worker-1' }),
      await outbox.claimById({ taskId: 'cuo-concurrency-by-id-2', workerId: 'queue-worker-2' }),
    ];

    expect(claims.every((result) => result.isOk())).toBe(true);
    expect(claims.filter((result) => result._unsafeUnwrap() !== null)).toHaveLength(1);
  });

  it('serializes by-id claims for one seed table while preserving capacity for another', async () => {
    await insertOutboxRow(db, {
      id: 'cuo-seed-concurrency-by-id-1',
      status: 'pending',
      baseId: PRIMARY_BASE_ID,
      seedTableId: PRIMARY_SEED_TABLE_ID,
    });
    await insertOutboxRow(db, {
      id: 'cuo-seed-concurrency-by-id-2',
      status: 'pending',
      baseId: PRIMARY_BASE_ID,
      seedTableId: PRIMARY_SEED_TABLE_ID,
    });
    await insertOutboxRow(db, {
      id: 'cuo-other-seed-concurrency-by-id',
      status: 'pending',
      baseId: PRIMARY_BASE_ID,
      seedTableId: SECONDARY_SEED_TABLE_ID,
    });
    const outbox = createTestOutbox(db, undefined, {
      maxConcurrentProcessingPerBase: 2,
      maxConcurrentProcessingPerSeedTable: 1,
    });

    const firstSameSeed = await outbox.claimById({
      taskId: 'cuo-seed-concurrency-by-id-1',
      workerId: 'queue-worker-1',
    });
    const secondSameSeed = await outbox.claimById({
      taskId: 'cuo-seed-concurrency-by-id-2',
      workerId: 'queue-worker-2',
    });
    const otherSeed = await outbox.claimById({
      taskId: 'cuo-other-seed-concurrency-by-id',
      workerId: 'queue-worker-3',
    });

    expect(firstSameSeed.isOk()).toBe(true);
    expect(firstSameSeed._unsafeUnwrap()?.id).toBe('cuo-seed-concurrency-by-id-1');
    expect(secondSameSeed.isOk()).toBe(true);
    expect(secondSameSeed._unsafeUnwrap()).toBeNull();
    expect(otherSeed.isOk()).toBe(true);
    expect(otherSeed._unsafeUnwrap()?.id).toBe('cuo-other-seed-concurrency-by-id');
  });

  it('does not exceed per-base concurrency within one batch claim', async () => {
    for (const [index, seedTableId] of [
      PRIMARY_SEED_TABLE_ID,
      SECONDARY_SEED_TABLE_ID,
      `tbl${'h'.repeat(16)}`,
    ].entries()) {
      await insertOutboxRow(db, {
        id: `cuo-batch-capacity-${index}`,
        status: 'pending',
        baseId: PRIMARY_BASE_ID,
        seedTableId,
      });
    }
    const outbox = createTestOutbox(db, undefined, {
      maxConcurrentProcessingPerBase: 2,
      maxConcurrentProcessingPerSeedTable: 1,
    });

    const claimed = await outbox.claimBatch({ workerId: 'poll-worker', limit: 10 });

    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap()).toHaveLength(2);
    const processing = await db
      .selectFrom('computed_update_outbox')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('status', '=', 'processing')
      .executeTakeFirstOrThrow();
    expect(Number(processing.count)).toBe(2);
  });

  it('claims pending work from a non-public data schema', async () => {
    const dataSchema = 'teable_internal';
    await sql.raw(`create schema "${dataSchema}"`).execute(db);
    await sql
      .raw(
        `create table "${dataSchema}"."computed_update_outbox" (like "public"."computed_update_outbox" including all)`
      )
      .execute(db);
    await sql
      .raw(
        `create table "${dataSchema}"."computed_update_outbox_seed" (like "public"."computed_update_outbox_seed" including all)`
      )
      .execute(db);
    await sql
      .raw(
        `create table "${dataSchema}"."computed_update_pause_scope" (like "public"."computed_update_pause_scope" including all)`
      )
      .execute(db);

    const dataDb = db.withSchema(dataSchema) as Kysely<V1TeableDatabase>;
    await insertOutboxRow(dataDb, {
      id: 'cuo-non-public-schema',
      status: 'pending',
    });

    await sql.raw('set search_path to pg_catalog').execute(db);
    try {
      const outbox = new ComputedUpdateOutbox(
        dataDb,
        { ...defaultComputedUpdateOutboxConfig, seedInlineLimit: 0 },
        createLogger(),
        db
      );
      const claimed = await outbox.claimBatch({
        workerId: 'schema-worker',
        limit: 1,
      });

      expect(claimed.isOk()).toBe(true);
      expect(claimed._unsafeUnwrap().map((task) => task.id)).toEqual(['cuo-non-public-schema']);
    } finally {
      await sql.raw('set search_path to public').execute(db);
      await sql.raw(`drop schema "${dataSchema}" cascade`).execute(db);
    }
  });

  it('reports an active lease retry time through the claim eligibility seam', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
    try {
      const lockedAt = new Date('2026-01-05T11:59:59.500Z');
      await insertOutboxRow(db, {
        id: 'cuo-active-eligibility',
        status: 'processing',
        lockedAt,
        lockedBy: 'active-worker:cuc_active',
      });

      const eligibility =
        await createTestOutbox(db).getTaskClaimEligibility('cuo-active-eligibility');

      expect(eligibility.isOk()).toBe(true);
      expect(eligibility._unsafeUnwrap()).toEqual({
        status: 'deferred',
        reason: 'active_lease',
        retryAt: new Date('2026-01-05T12:00:00.500Z'),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports legacy indefinite and scheduled pauses through the claim eligibility seam', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
    try {
      await insertOutboxRow(db, { id: 'cuo-paused-eligibility', status: 'pending' });
      await db
        .insertInto('computed_update_pause_scope')
        .values({
          id: 'cup-legacy-indefinite',
          scope_type: 'base',
          scope_id: PRIMARY_BASE_ID,
          paused_at: new Date('2026-01-05T11:00:00Z'),
          paused_by: 'legacy-operator',
          resume_at: null,
          reason: 'legacy pause',
          updated_at: new Date('2026-01-05T11:00:00Z'),
          updated_by: 'legacy-operator',
        })
        .execute();
      const outbox = createTestOutbox(db);

      const indefinite = await outbox.getTaskClaimEligibility('cuo-paused-eligibility');
      expect(indefinite._unsafeUnwrap()).toEqual({
        status: 'deferred',
        reason: 'paused',
        retryAt: null,
      });

      const resumeAt = new Date('2026-01-05T12:05:00Z');
      await db
        .updateTable('computed_update_pause_scope')
        .set({ resume_at: resumeAt, updated_at: new Date('2026-01-05T12:00:00Z') })
        .where('id', '=', 'cup-legacy-indefinite')
        .execute();
      const scheduled = await outbox.getTaskClaimEligibility('cuo-paused-eligibility');
      expect(scheduled._unsafeUnwrap()).toEqual({
        status: 'deferred',
        reason: 'paused',
        retryAt: resumeAt,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('publishes an outbox wake-up only after the caller transaction commits', async () => {
    const publisher = new RecordingWakeupPublisher();
    const outbox = createTestOutbox(db, publisher);
    const task = buildSeedTaskInput({
      baseId: BaseId.create(PRIMARY_BASE_ID)._unsafeUnwrap(),
      seedTableId: TableId.create(PRIMARY_SEED_TABLE_ID)._unsafeUnwrap(),
      seedRecordIds: [createRecordId(1)],
      extraSeedRecords: [],
      changedFieldIds: [FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap()],
      changeType: 'update',
      hasher: new NoopHasher(),
      runId: 'run-wakeup-after-commit',
    });
    let transaction: PostgresUnitOfWorkTransaction<unknown> | undefined;

    await db.transaction().execute(async (trx) => {
      transaction = new PostgresUnitOfWorkTransaction(trx as never, 'data');
      const result = await outbox.enqueueSeedTask(task, { transaction } as never);

      expect(result.isOk()).toBe(true);
      expect(publisher.wakeups).toEqual([]);
    });

    expect(publisher.wakeups).toEqual([]);
    await transaction?.runAfterCommitHandlers();
    expect(publisher.wakeups).toHaveLength(1);
    expect(publisher.wakeups[0]).toMatchObject({
      schemaVersion: 1,
      baseId: PRIMARY_BASE_ID,
      cause: 'created',
    });
  });

  it('does not publish early when an external transaction has no after-commit hook', async () => {
    const publisher = new RecordingWakeupPublisher();
    const outbox = createTestOutbox(db, publisher);
    const task = buildSeedTaskInput({
      baseId: BaseId.create(PRIMARY_BASE_ID)._unsafeUnwrap(),
      seedTableId: TableId.create(PRIMARY_SEED_TABLE_ID)._unsafeUnwrap(),
      seedRecordIds: [createRecordId(1)],
      extraSeedRecords: [],
      changedFieldIds: [FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap()],
      changeType: 'update',
      hasher: new NoopHasher(),
      runId: 'run-wakeup-missing-after-commit',
    });

    const result = await outbox.enqueueSeedTask(task, {
      transaction: { kind: 'unitOfWorkTransaction', scope: 'data' },
    } as never);

    expect(result.isOk()).toBe(true);
    expect(publisher.wakeups).toEqual([]);
  });

  it('publishes a delayed wake-up when a claimed task is scheduled for retry', async () => {
    await insertOutboxRow(db, {
      id: 'cuo-failed-retry',
      status: 'pending',
    });
    const publisher = new RecordingWakeupPublisher();
    const outbox = createTestOutbox(db, publisher);
    const claimed = await outbox.claimById({
      taskId: 'cuo-failed-retry',
      workerId: 'queue-worker',
    });
    expect(claimed.isOk()).toBe(true);
    const task = claimed._unsafeUnwrap();
    expect(task).not.toBeNull();

    const failed = await outbox.markFailed(task!, 'temporary failure');

    expect(failed.isOk()).toBe(true);
    expect(failed._unsafeUnwrap()).toBe(true);
    expect(publisher.wakeups).toEqual([
      expect.objectContaining({
        taskId: 'cuo-failed-retry',
        baseId: PRIMARY_BASE_ID,
        cause: 'retry',
      }),
    ]);
    expect(publisher.wakeups[0]!.availableAt.getTime()).toBeGreaterThan(
      publisher.wakeups[0]!.emittedAt.getTime()
    );
  });

  it('keeps a committed outbox task when wake-up publication fails', async () => {
    const outbox = createTestOutbox(db, new ThrowingWakeupPublisher());
    const task = buildSeedTaskInput({
      baseId: BaseId.create(PRIMARY_BASE_ID)._unsafeUnwrap(),
      seedTableId: TableId.create(PRIMARY_SEED_TABLE_ID)._unsafeUnwrap(),
      seedRecordIds: [createRecordId(1)],
      extraSeedRecords: [],
      changedFieldIds: [FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap()],
      changeType: 'update',
      hasher: new NoopHasher(),
      runId: 'run-publish-failure',
    });

    const result = await outbox.enqueueSeedTask(task);

    expect(result.isOk()).toBe(true);
    const rows = await db
      .selectFrom('computed_update_outbox')
      .select('id')
      .where('id', '=', result._unsafeUnwrap().taskId)
      .execute();
    expect(rows).toHaveLength(1);
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

  it('merges duplicate seed tasks inside the caller transaction', async () => {
    const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
    const seedTableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
    const firstFieldId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
    const secondFieldId = FieldId.create(`fld${'h'.repeat(16)}`)._unsafeUnwrap();
    const hasher = new NoopHasher();
    const outbox = createTestOutbox(db);

    const firstTask = buildSeedTaskInput({
      baseId,
      seedTableId,
      seedRecordIds: [createRecordId(1), createRecordId(2)],
      extraSeedRecords: [],
      changedFieldIds: [firstFieldId],
      changeType: 'update',
      hasher,
      runId: 'run-first',
    });
    const secondTask = buildSeedTaskInput({
      baseId,
      seedTableId,
      seedRecordIds: [createRecordId(2), createRecordId(3)],
      extraSeedRecords: [],
      changedFieldIds: [secondFieldId],
      changeType: 'update',
      hasher,
      runId: 'run-second',
    });

    await db.transaction().execute(async (trx) => {
      const context = {
        transaction: new PostgresUnitOfWorkTransaction(trx as never, 'data'),
      };

      const first = await outbox.enqueueSeedTask(firstTask, context as never);
      const second = await outbox.enqueueSeedTask(secondTask, context as never);

      expect(first.isOk()).toBe(true);
      expect(first._unsafeUnwrap()).toMatchObject({ merged: false });
      expect(second.isOk()).toBe(true);
      expect(second._unsafeUnwrap()).toMatchObject({
        taskId: first._unsafeUnwrap().taskId,
        merged: true,
      });
    });

    const outboxRows = await db.selectFrom('computed_update_outbox').selectAll().execute();
    expect(outboxRows.length).toBe(1);
    expect(outboxRows[0].affected_field_ids).toEqual([
      firstFieldId.toString(),
      secondFieldId.toString(),
    ]);

    const seedRows = await db
      .selectFrom('computed_update_outbox_seed')
      .select(['table_id', 'record_id'])
      .orderBy('record_id')
      .execute();

    expect(seedRows.map((row) => `${row.table_id}|${row.record_id}`)).toEqual([
      `${seedTableId.toString()}|${createRecordId(1).toString()}`,
      `${seedTableId.toString()}|${createRecordId(2).toString()}`,
      `${seedTableId.toString()}|${createRecordId(3).toString()}`,
    ]);
  });

  it('merges processing seed retry into existing pending task instead of waiting for stale lease', async () => {
    const now = new Date('2026-01-05T12:00:10Z');
    const planHash = 'same-seed-plan';
    const firstFieldId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
    const secondFieldId = FieldId.create(`fld${'h'.repeat(16)}`)._unsafeUnwrap();
    const firstRecordId = createRecordId(1).toString();
    const secondRecordId = createRecordId(2).toString();
    const leaseOwner = 'worker-old:cuc_old';

    await insertOutboxRow(db, {
      id: 'cuo-pending-seed',
      status: 'pending',
      rowChangeType: 'seed',
      planHash,
      seedRecordIds: [firstRecordId],
      affectedFieldIds: [firstFieldId.toString()],
      dirtyStats: { changeType: 'update', beforeImageRecords: [] },
      createdAt: new Date(now.getTime() - 10_000),
      updatedAt: new Date(now.getTime() - 10_000),
    });
    await insertOutboxRow(db, {
      id: 'cuo-processing-seed',
      status: 'processing',
      rowChangeType: 'seed',
      planHash,
      seedRecordIds: [secondRecordId],
      affectedFieldIds: [secondFieldId.toString()],
      dirtyStats: { changeType: 'update', beforeImageRecords: [] },
      lockedAt: new Date(now.getTime() - 100),
      lockedBy: leaseOwner,
      createdAt: new Date(now.getTime() - 1_000),
      updatedAt: new Date(now.getTime() - 100),
    });

    const publisher = new RecordingWakeupPublisher();
    const outbox = createTestOutbox(db, publisher);
    const task: SeedOutboxItem = {
      taskType: 'seed',
      id: 'cuo-processing-seed',
      baseId: PRIMARY_BASE_ID,
      seedTableId: PRIMARY_SEED_TABLE_ID,
      seedRecordIds: [secondRecordId],
      extraSeedRecords: [],
      beforeImageRecords: [],
      changedFieldIds: [secondFieldId.toString()],
      changeType: 'update',
      runId: 'run-processing',
      planHash,
      status: 'processing',
      attempts: 0,
      maxAttempts: 8,
      nextRunAt: now,
      lockedAt: new Date(now.getTime() - 100),
      lockedBy: leaseOwner,
      lastError: null,
      createdAt: new Date(now.getTime() - 1_000),
      updatedAt: new Date(now.getTime() - 100),
    };

    const released = await outbox.releaseForRetry({
      task,
      reason: 'lock unavailable',
      retryDelayMs: 0,
      now,
    });

    expect(released.isOk()).toBe(true);
    expect(released._unsafeUnwrap()).toBe(true);

    const rows = await db
      .selectFrom('computed_update_outbox')
      .select(['id', 'status', 'affected_field_ids'])
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('cuo-pending-seed');
    expect(rows[0].status).toBe('pending');
    expect(rows[0].affected_field_ids).toEqual([firstFieldId.toString(), secondFieldId.toString()]);

    const seedRows = await db
      .selectFrom('computed_update_outbox_seed')
      .select(['task_id', 'table_id', 'record_id'])
      .orderBy('record_id')
      .execute();
    expect(seedRows.map((row) => `${row.task_id}|${row.table_id}|${row.record_id}`)).toEqual([
      `cuo-pending-seed|${PRIMARY_SEED_TABLE_ID}|${firstRecordId}`,
      `cuo-pending-seed|${PRIMARY_SEED_TABLE_ID}|${secondRecordId}`,
    ]);
    expect(publisher.wakeups).toEqual([
      expect.objectContaining({
        taskId: 'cuo-pending-seed',
        baseId: PRIMARY_BASE_ID,
        availableAt: now,
        cause: 'retry',
      }),
    ]);
  });

  it('preserves durable staging state when a computed retry merges into a pending task', async () => {
    const now = new Date('2026-01-05T12:00:20Z');
    const planHash = 'same-computed-plan';
    const cursorRecordId = `rec${'p'.repeat(16)}`;
    const leaseOwner = 'worker-old:cuc_old2';

    await insertOutboxRow(db, {
      id: 'cuo-pending-comp',
      status: 'pending',
      planHash,
      seedRecordIds: [createRecordId(3).toString()],
      dirtyStats: { dirtyStats: [] },
      createdAt: new Date(now.getTime() - 10_000),
      updatedAt: new Date(now.getTime() - 10_000),
    });
    await insertOutboxRow(db, {
      id: 'cuo-processing-comp',
      status: 'processing',
      planHash,
      seedRecordIds: [createRecordId(4).toString()],
      dirtyStats: { dirtyStats: [] },
      lockedAt: new Date(now.getTime() - 100),
      lockedBy: leaseOwner,
      createdAt: new Date(now.getTime() - 1_000),
      updatedAt: new Date(now.getTime() - 100),
    });

    const publisher = new RecordingWakeupPublisher();
    const outbox = createTestOutbox(db, publisher);
    const task = {
      id: 'cuo-processing-comp',
      baseId: PRIMARY_BASE_ID,
      seedTableId: PRIMARY_SEED_TABLE_ID,
      seedRecordIds: [createRecordId(4).toString()],
      extraSeedRecords: [],
      beforeImageRecords: [],
      steps: [],
      sameTableBatches: [],
      edges: [],
      estimatedComplexity: 1,
      changeType: 'update' as const,
      planHash,
      dirtyStats: [],
      // Durable staging state that a retry-merge must not drop.
      seedAllTableIds: [PRIMARY_SEED_TABLE_ID],
      seedAllCursors: { [PRIMARY_SEED_TABLE_ID]: cursorRecordId },
      ledgerScopeId: 'cuo-chain-root',
      runId: 'run-processing-comp',
      originRunIds: [],
      runTotalSteps: 1,
      runCompletedStepsBefore: 0,
      affectedTableIds: [PRIMARY_SEED_TABLE_ID],
      affectedFieldIds: [],
      syncMaxLevel: 0,
      status: 'processing' as const,
      attempts: 0,
      maxAttempts: 8,
      nextRunAt: now,
      lockedAt: new Date(now.getTime() - 100),
      lockedBy: leaseOwner,
      lastError: null,
      createdAt: new Date(now.getTime() - 1_000),
      updatedAt: new Date(now.getTime() - 100),
    };

    const released = await outbox.releaseForRetry({
      task: task as never,
      reason: 'lock unavailable',
      retryDelayMs: 0,
      now,
    });

    expect(released.isOk()).toBe(true);
    expect(released._unsafeUnwrap()).toBe(true);

    const rows = await db
      .selectFrom('computed_update_outbox')
      .select(['id', 'status', 'dirty_stats'])
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('cuo-pending-comp');
    const envelope =
      typeof rows[0].dirty_stats === 'string'
        ? JSON.parse(rows[0].dirty_stats)
        : (rows[0].dirty_stats as Record<string, unknown>);
    expect(envelope.seedAllTableIds).toEqual([PRIMARY_SEED_TABLE_ID]);
    expect(envelope.seedAllCursors).toEqual({ [PRIMARY_SEED_TABLE_ID]: cursorRecordId });
    expect(envelope.ledgerScopeId).toBe('cuo-chain-root');
  });

  it('never drops dirty data when the merge target is claimed out from under enqueueOrMerge (T6648)', async () => {
    // pglite is a single connection, so this cannot drive two genuinely
    // concurrent transactions. It instead drives the state transition a real
    // race would produce: a pending merge target that another worker claims
    // (pending -> processing) between when the caller decided to merge into
    // it and when enqueueOrMerge actually runs. The regression this guards:
    // the caller's dirty data must never vanish just because its intended
    // merge target is no longer mergeable — it must land as an independent
    // task instead.
    const now = new Date('2026-01-05T12:00:30Z');
    const planHash = 'race-merge-plan';
    const originalSeedRecordId = createRecordId(10).toString();
    const incomingSeedRecordId = createRecordId(11).toString();

    await insertOutboxRow(db, {
      id: 'cuo-race-target',
      status: 'pending',
      planHash,
      seedRecordIds: [originalSeedRecordId],
      dirtyStats: { dirtyStats: [{ tableId: PRIMARY_SEED_TABLE_ID, recordCount: 1 }] },
      createdAt: new Date(now.getTime() - 5_000),
      updatedAt: new Date(now.getTime() - 5_000),
    });

    // Simulate another worker's claimBatch winning the row lock and
    // committing first: the intended merge target is no longer 'pending' by
    // the time our enqueue actually runs.
    const claimOwner = 'worker-other:cuc_other';
    await db
      .updateTable('computed_update_outbox')
      .set({
        status: 'processing',
        locked_at: now,
        locked_by: claimOwner,
        updated_at: now,
      })
      .where('id', '=', 'cuo-race-target')
      .execute();

    const outbox = createTestOutbox(db);
    const incomingTask = {
      baseId: PRIMARY_BASE_ID,
      seedTableId: PRIMARY_SEED_TABLE_ID,
      seedRecordIds: [incomingSeedRecordId],
      extraSeedRecords: [],
      beforeImageRecords: [],
      steps: [],
      sameTableBatches: [],
      edges: [],
      estimatedComplexity: 1,
      changeType: 'update' as const,
      planHash,
      dirtyStats: [{ tableId: PRIMARY_SEED_TABLE_ID, recordCount: 1 }],
      runId: 'run-race-incoming',
      originRunIds: [],
      runTotalSteps: 1,
      runCompletedStepsBefore: 0,
      affectedTableIds: [PRIMARY_SEED_TABLE_ID],
      affectedFieldIds: [],
      syncMaxLevel: 0,
    };

    const result = await outbox.enqueueOrMerge(incomingTask as never);

    expect(result.isOk()).toBe(true);
    const outcome = result._unsafeUnwrap();
    // Cannot merge into a row that is no longer pending: falls back to a
    // fresh insert rather than silently discarding the caller's dirty data.
    expect(outcome.merged).toBe(false);
    expect(outcome.taskId).not.toBe('cuo-race-target');

    const rows = await db
      .selectFrom('computed_update_outbox')
      .select(['id', 'status', 'locked_by', 'seed_record_ids'])
      .orderBy('id')
      .execute();
    expect(rows).toHaveLength(2);

    // The original processing row is untouched by the merge attempt.
    const claimedRow = rows.find((row) => row.id === 'cuo-race-target');
    expect(claimedRow?.status).toBe('processing');
    expect(claimedRow?.locked_by).toBe(claimOwner);

    // The caller's dirty data survives as its own independent, immediately
    // claimable pending task — never silently lost. This test's outbox
    // config (seedInlineLimit: 0) spills seeds to the seed table rather than
    // the inline JSON column.
    const newRow = rows.find((row) => row.id === outcome.taskId);
    expect(newRow).toBeDefined();
    expect(newRow?.status).toBe('pending');
    const seedRows = await db
      .selectFrom('computed_update_outbox_seed')
      .select(['table_id', 'record_id'])
      .where('task_id', '=', outcome.taskId)
      .execute();
    expect(seedRows.map((row) => row.record_id)).toEqual([incomingSeedRecordId]);
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

  it('charges an attempt when reclaiming an expired lease', async () => {
    const now = new Date('2026-01-05T12:00:10Z');
    await insertOutboxRow(db, {
      id: 'cuo-crash-attempt',
      status: 'processing',
      attempts: 2,
      lockedAt: new Date(now.getTime() - 1500),
      lockedBy: 'worker-dead:cuc_dead',
      createdAt: new Date(now.getTime() - 10_000),
      updatedAt: new Date(now.getTime() - 1500),
    });

    const claimed = await createTestOutbox(db).claimBatch({
      workerId: 'worker-new',
      limit: 10,
      now,
    });

    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap()).toHaveLength(1);
    expect(claimed._unsafeUnwrap()[0].attempts).toBe(3);

    const row = await db
      .selectFrom('computed_update_outbox')
      .select(['attempts', 'status'])
      .where('id', '=', 'cuo-crash-attempt')
      .executeTakeFirstOrThrow();
    expect(Number(row.attempts)).toBe(3);
    expect(row.status).toBe('processing');
  });

  it('dead-letters a crash-looping task whose retry budget is exhausted instead of reclaiming it', async () => {
    const now = new Date('2026-01-05T12:00:10Z');
    await insertOutboxRow(db, {
      id: 'cuo-poison',
      status: 'processing',
      attempts: 7,
      maxAttempts: 8,
      lockedAt: new Date(now.getTime() - 1500),
      lockedBy: 'worker-dead:cuc_dead',
      createdAt: new Date(now.getTime() - 10_000),
      updatedAt: new Date(now.getTime() - 1500),
    });

    const claimed = await createTestOutbox(db).claimBatch({
      workerId: 'worker-new',
      limit: 10,
      now,
    });

    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap()).toHaveLength(0);

    const outboxRow = await db
      .selectFrom('computed_update_outbox')
      .select('id')
      .where('id', '=', 'cuo-poison')
      .executeTakeFirst();
    expect(outboxRow).toBeUndefined();

    const deadRow = await db
      .selectFrom('computed_update_dead_letter')
      .select(['attempts', 'last_error', 'status'])
      .where('id', '=', 'cuo-poison')
      .executeTakeFirstOrThrow();
    expect(Number(deadRow.attempts)).toBe(8);
    expect(deadRow.status).toBe('dead');
    expect(String(deadRow.last_error)).toContain('processing lease expired');
  });

  it('keeps an exhausted stale task parked instead of dead-lettering it while its base is paused', async () => {
    const now = new Date('2026-01-05T12:00:10Z');
    await insertOutboxRow(db, {
      id: 'cuo-poison-paused',
      status: 'processing',
      attempts: 7,
      maxAttempts: 8,
      lockedAt: new Date(now.getTime() - 1500),
      lockedBy: 'worker-dead:cuc_dead',
      createdAt: new Date(now.getTime() - 10_000),
      updatedAt: new Date(now.getTime() - 1500),
    });
    await createPauseRegistry(db).pauseScope({
      scopeType: 'base',
      scopeId: PRIMARY_BASE_ID,
      actor: 'tester',
    });

    const claimed = await createTestOutbox(db).claimBatch({
      workerId: 'worker-new',
      limit: 10,
      now,
    });

    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap()).toHaveLength(0);

    const row = await db
      .selectFrom('computed_update_outbox')
      .select(['status', 'attempts'])
      .where('id', '=', 'cuo-poison-paused')
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('processing');
    expect(Number(row.attempts)).toBe(7);

    const deadRow = await db
      .selectFrom('computed_update_dead_letter')
      .select('id')
      .where('id', '=', 'cuo-poison-paused')
      .executeTakeFirst();
    expect(deadRow).toBeUndefined();
  });

  it('charges an attempt when a by-id claim takes over an expired lease', async () => {
    const now = new Date('2026-01-05T12:00:10Z');
    await insertOutboxRow(db, {
      id: 'cuo-crash-by-id',
      status: 'processing',
      attempts: 1,
      lockedAt: new Date(now.getTime() - 1500),
      lockedBy: 'worker-dead:cuc_dead',
      createdAt: new Date(now.getTime() - 10_000),
      updatedAt: new Date(now.getTime() - 1500),
    });

    const claimed = await createTestOutbox(db).claimById({
      taskId: 'cuo-crash-by-id',
      workerId: 'queue-worker',
      now,
    });

    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap()?.attempts).toBe(2);

    const row = await db
      .selectFrom('computed_update_outbox')
      .select('attempts')
      .where('id', '=', 'cuo-crash-by-id')
      .executeTakeFirstOrThrow();
    expect(Number(row.attempts)).toBe(2);
  });

  it('dead-letters an exhausted expired task on a by-id claim', async () => {
    const now = new Date('2026-01-05T12:00:10Z');
    await insertOutboxRow(db, {
      id: 'cuo-poison-by-id',
      status: 'processing',
      attempts: 7,
      maxAttempts: 8,
      lockedAt: new Date(now.getTime() - 1500),
      lockedBy: 'worker-dead:cuc_dead',
      createdAt: new Date(now.getTime() - 10_000),
      updatedAt: new Date(now.getTime() - 1500),
    });

    const claimed = await createTestOutbox(db).claimById({
      taskId: 'cuo-poison-by-id',
      workerId: 'queue-worker',
      now,
    });

    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap()).toBeNull();

    const outboxRow = await db
      .selectFrom('computed_update_outbox')
      .select('id')
      .where('id', '=', 'cuo-poison-by-id')
      .executeTakeFirst();
    expect(outboxRow).toBeUndefined();

    const deadRow = await db
      .selectFrom('computed_update_dead_letter')
      .select(['attempts', 'last_error'])
      .where('id', '=', 'cuo-poison-by-id')
      .executeTakeFirstOrThrow();
    expect(Number(deadRow.attempts)).toBe(8);
    expect(String(deadRow.last_error)).toContain('processing lease expired');
  });

  it('does not charge an attempt when takeover relays a live lease', async () => {
    const now = new Date('2026-01-05T12:00:10Z');
    await insertOutboxRow(db, {
      id: 'cuo-relay-live',
      status: 'processing',
      attempts: 3,
      lockedAt: new Date(now.getTime() - 200),
      lockedBy: 'worker-prev:cuc_prev',
      createdAt: new Date(now.getTime() - 10_000),
      updatedAt: new Date(now.getTime() - 200),
    });

    const claimed = await createTestOutbox(db).claimById({
      taskId: 'cuo-relay-live',
      workerId: 'queue-worker',
      allowProcessingTakeover: true,
      now,
    });

    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap()?.attempts).toBe(3);

    const row = await db
      .selectFrom('computed_update_outbox')
      .select('attempts')
      .where('id', '=', 'cuo-relay-live')
      .executeTakeFirstOrThrow();
    expect(Number(row.attempts)).toBe(3);
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

  it('claims lightweight pending work while another same-table task is processing', async () => {
    const now = new Date('2026-01-05T12:00:10Z');

    await insertOutboxRow(db, {
      id: 'cuo-processing',
      status: 'processing',
      lockedAt: new Date(now.getTime() - 100),
      lockedBy: 'worker-busy:cuc_busy',
      createdAt: new Date(now.getTime() - 20_000),
      updatedAt: new Date(now.getTime() - 100),
      estimatedComplexity: 200,
    });

    await insertOutboxRow(db, {
      id: 'cuo-heavy',
      status: 'pending',
      nextRunAt: new Date(now.getTime() - 10_000),
      createdAt: new Date(now.getTime() - 10_000),
      updatedAt: new Date(now.getTime() - 10_000),
      estimatedComplexity: 100,
    });

    await insertOutboxRow(db, {
      id: 'cuo-light',
      status: 'pending',
      nextRunAt: now,
      createdAt: now,
      updatedAt: now,
      estimatedComplexity: 2,
    });

    const outbox = createTestOutbox(db, undefined, {
      maxConcurrentProcessingPerSeedTable: 2,
    });
    const claimed = await outbox.claimBatch({
      workerId: 'worker-new',
      limit: 10,
      now,
    });

    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap().map((task) => task.id)).toEqual(['cuo-light']);
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

  it('skips tasks whose base scope is paused', async () => {
    await insertOutboxRow(db, {
      id: 'cuo-paused-base',
      status: 'pending',
      baseId: PRIMARY_BASE_ID,
      seedTableId: PRIMARY_SEED_TABLE_ID,
    });
    await insertOutboxRow(db, {
      id: 'cuo-unpaused-base',
      status: 'pending',
      baseId: SECONDARY_BASE_ID,
      seedTableId: SECONDARY_SEED_TABLE_ID,
    });

    const pauseRegistry = createPauseRegistry(db);
    await pauseRegistry.pauseScope({
      scopeType: 'base',
      scopeId: PRIMARY_BASE_ID,
      actor: 'tester',
    });

    const outbox = createTestOutbox(db);
    const claimed = await outbox.claimBatch({ workerId: 'worker-base', limit: 10 });

    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap().map((task) => task.id)).toEqual(['cuo-unpaused-base']);
  });

  it('skips tasks whose table scope is paused through affected_table_ids', async () => {
    await insertOutboxRow(db, {
      id: 'cuo-paused-table',
      status: 'pending',
      baseId: PRIMARY_BASE_ID,
      seedTableId: PRIMARY_SEED_TABLE_ID,
      affectedTableIds: [PRIMARY_TARGET_TABLE_ID],
    });
    await insertOutboxRow(db, {
      id: 'cuo-unpaused-table',
      status: 'pending',
      baseId: SECONDARY_BASE_ID,
      seedTableId: SECONDARY_SEED_TABLE_ID,
      affectedTableIds: [SECONDARY_TARGET_TABLE_ID],
    });

    const pauseRegistry = createPauseRegistry(db);
    await pauseRegistry.pauseScope({
      scopeType: 'table',
      scopeId: PRIMARY_TARGET_TABLE_ID,
      actor: 'tester',
    });

    const outbox = createTestOutbox(db);
    const claimed = await outbox.claimBatch({ workerId: 'worker-table', limit: 10 });

    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap().map((task) => task.id)).toEqual(['cuo-unpaused-table']);
  });

  it('skips tasks whose space scope is paused', async () => {
    await insertOutboxRow(db, {
      id: 'cuo-paused-space',
      status: 'pending',
      baseId: PRIMARY_BASE_ID,
      seedTableId: PRIMARY_SEED_TABLE_ID,
    });
    await insertOutboxRow(db, {
      id: 'cuo-unpaused-space',
      status: 'pending',
      baseId: SECONDARY_BASE_ID,
      seedTableId: SECONDARY_SEED_TABLE_ID,
    });

    const pauseRegistry = createPauseRegistry(db);
    await pauseRegistry.pauseScope({
      scopeType: 'space',
      scopeId: PRIMARY_SPACE_ID,
      actor: 'tester',
    });

    const outbox = createTestOutbox(db);
    const claimed = await outbox.claimBatch({ workerId: 'worker-space', limit: 10 });

    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap().map((task) => task.id)).toEqual(['cuo-unpaused-space']);
  });

  it('defers due pending tasks out of the claim scan while their base scope is paused', async () => {
    await insertOutboxRow(db, {
      id: 'cuo-defer-primary',
      status: 'pending',
      baseId: PRIMARY_BASE_ID,
      seedTableId: PRIMARY_SEED_TABLE_ID,
    });
    await insertOutboxRow(db, {
      id: 'cuo-defer-secondary',
      status: 'pending',
      baseId: SECONDARY_BASE_ID,
      seedTableId: SECONDARY_SEED_TABLE_ID,
    });
    const secondaryDueAt = await readTaskNextRunAt(db, 'cuo-defer-secondary');

    const resumeAt = new Date(Date.now() + 60 * 60 * 1000);
    const pauseRegistry = createPauseRegistry(db);
    const paused = await pauseRegistry.pauseScope({
      scopeType: 'base',
      scopeId: PRIMARY_BASE_ID,
      resumeAt,
      actor: 'tester',
    });
    expect(paused.isOk()).toBe(true);

    // The paused base's due backlog leaves the hot claim scan entirely: the
    // pending probe and scan predicate key on next_run_at <= now, so a deferred
    // row costs zero per-poll work until the lease expires.
    expect(await readTaskNextRunAt(db, 'cuo-defer-primary')).toEqual(resumeAt);
    expect(await readTaskNextRunAt(db, 'cuo-defer-secondary')).toEqual(secondaryDueAt);

    const outbox = createTestOutbox(db);
    const claimed = await outbox.claimBatch({ workerId: 'worker-defer', limit: 10 });
    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap().map((task) => task.id)).toEqual(['cuo-defer-secondary']);
  });

  it('restores deferred tasks to due when the scope resumes early', async () => {
    await insertOutboxRow(db, {
      id: 'cuo-restore-primary',
      status: 'pending',
      baseId: PRIMARY_BASE_ID,
      seedTableId: PRIMARY_SEED_TABLE_ID,
    });

    const resumeAt = new Date(Date.now() + 60 * 60 * 1000);
    const pauseRegistry = createPauseRegistry(db);
    await pauseRegistry.pauseScope({
      scopeType: 'base',
      scopeId: PRIMARY_BASE_ID,
      resumeAt,
      actor: 'tester',
    });
    expect(await readTaskNextRunAt(db, 'cuo-restore-primary')).toEqual(resumeAt);

    const resumed = await pauseRegistry.resumeScope({
      scopeType: 'base',
      scopeId: PRIMARY_BASE_ID,
      actor: 'tester',
    });
    expect(resumed.isOk()).toBe(true);
    expect(resumed._unsafeUnwrap()).toBe(true);
    expect((await readTaskNextRunAt(db, 'cuo-restore-primary')).getTime()).toBeLessThanOrEqual(
      Date.now()
    );

    const outbox = createTestOutbox(db);
    const claimed = await outbox.claimBatch({ workerId: 'worker-restore', limit: 10 });
    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap().map((task) => task.id)).toEqual(['cuo-restore-primary']);
  });

  it('claims deferred tasks automatically once the pause lease expires', async () => {
    await insertOutboxRow(db, {
      id: 'cuo-expiry-primary',
      status: 'pending',
      baseId: PRIMARY_BASE_ID,
      seedTableId: PRIMARY_SEED_TABLE_ID,
    });

    const resumeAt = new Date(Date.now() + 30 * 60 * 1000);
    const pauseRegistry = createPauseRegistry(db);
    await pauseRegistry.pauseScope({
      scopeType: 'base',
      scopeId: PRIMARY_BASE_ID,
      resumeAt,
      actor: 'tester',
    });
    expect(await readTaskNextRunAt(db, 'cuo-expiry-primary')).toEqual(resumeAt);

    // No manual resume: once the lease expires the deferred row is due again,
    // so the backlog drains without an operator touching the queue.
    const outbox = createTestOutbox(db);
    const claimed = await outbox.claimBatch({
      workerId: 'worker-expiry',
      limit: 10,
      now: new Date(resumeAt.getTime() + 60_000),
    });
    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap().map((task) => task.id)).toEqual(['cuo-expiry-primary']);
  });

  it('defers pending tasks matched by table and space scopes', async () => {
    await insertOutboxRow(db, {
      id: 'cuo-defer-table',
      status: 'pending',
      baseId: PRIMARY_BASE_ID,
      seedTableId: PRIMARY_SEED_TABLE_ID,
      affectedTableIds: [PRIMARY_TARGET_TABLE_ID],
    });
    await insertOutboxRow(db, {
      id: 'cuo-defer-space',
      status: 'pending',
      baseId: SECONDARY_BASE_ID,
      seedTableId: SECONDARY_SEED_TABLE_ID,
    });

    const tableResumeAt = new Date(Date.now() + 60 * 60 * 1000);
    const pauseRegistry = createPauseRegistry(db);
    await pauseRegistry.pauseScope({
      scopeType: 'table',
      scopeId: PRIMARY_TARGET_TABLE_ID,
      resumeAt: tableResumeAt,
      actor: 'tester',
    });
    expect(await readTaskNextRunAt(db, 'cuo-defer-table')).toEqual(tableResumeAt);

    const spaceResumeAt = new Date(Date.now() + 45 * 60 * 1000);
    await pauseRegistry.pauseScope({
      scopeType: 'space',
      scopeId: SECONDARY_SPACE_ID,
      resumeAt: spaceResumeAt,
      actor: 'tester',
    });
    expect(await readTaskNextRunAt(db, 'cuo-defer-space')).toEqual(spaceResumeAt);

    const outbox = createTestOutbox(db);
    const claimed = await outbox.claimBatch({ workerId: 'worker-scopes', limit: 10 });
    expect(claimed.isOk()).toBe(true);
    expect(claimed._unsafeUnwrap()).toHaveLength(0);
  });

  it('reports paused rather than not_due for a pause-deferred task through the eligibility seam', async () => {
    await insertOutboxRow(db, {
      id: 'cuo-defer-eligibility',
      status: 'pending',
      baseId: PRIMARY_BASE_ID,
      seedTableId: PRIMARY_SEED_TABLE_ID,
    });

    const resumeAt = new Date(Date.now() + 60 * 60 * 1000);
    const pauseRegistry = createPauseRegistry(db);
    await pauseRegistry.pauseScope({
      scopeType: 'base',
      scopeId: PRIMARY_BASE_ID,
      resumeAt,
      actor: 'tester',
    });

    const outbox = createTestOutbox(db);
    const eligibility = await outbox.getTaskClaimEligibility('cuo-defer-eligibility');
    expect(eligibility.isOk()).toBe(true);
    expect(eligibility._unsafeUnwrap()).toEqual({
      status: 'deferred',
      reason: 'paused',
      retryAt: resumeAt,
    });
  });

  it('lists active pause scopes with resolved metadata and supports resume', async () => {
    const registry = createPauseRegistry(db);
    const futureResumeAt = new Date(Date.now() + 60 * 60 * 1000);

    const paused = await registry.pauseScope({
      scopeType: 'table',
      scopeId: PRIMARY_SEED_TABLE_ID,
      resumeAt: futureResumeAt,
      reason: 'ops maintenance',
      actor: 'tester',
    });

    expect(paused.isOk()).toBe(true);
    expect(paused._unsafeUnwrap().scopeName).toBe('Primary Seed');
    expect(paused._unsafeUnwrap().baseName).toBe('Primary Base');
    expect(paused._unsafeUnwrap().spaceName).toBe('Primary Space');

    const activeScopes = await registry.listScopes({ activeOnly: true });
    expect(activeScopes.isOk()).toBe(true);
    expect(activeScopes._unsafeUnwrap()).toHaveLength(1);
    expect(activeScopes._unsafeUnwrap()[0].active).toBe(true);

    const resumed = await registry.resumeScope({
      scopeType: 'table',
      scopeId: PRIMARY_SEED_TABLE_ID,
    });
    expect(resumed.isOk()).toBe(true);
    expect(resumed._unsafeUnwrap()).toBe(true);

    const remaining = await registry.listScopes({ activeOnly: false });
    expect(remaining.isOk()).toBe(true);
    expect(remaining._unsafeUnwrap()).toHaveLength(1);
    expect(remaining._unsafeUnwrap()[0].active).toBe(false);
  });

  it('releases one pause lease by id and preserves it as inactive history', async () => {
    const registry = createPauseRegistry(db);
    const paused = await registry.pauseScope({
      scopeType: 'base',
      scopeId: PRIMARY_BASE_ID,
      resumeAt: new Date(Date.now() + 60 * 60 * 1000),
      actor: 'pause-operator',
    });
    expect(paused.isOk()).toBe(true);

    const released = await registry.releaseLease({
      leaseId: paused._unsafeUnwrap().id,
      actor: 'resume-operator',
      releaseReason: 'maintenance complete',
    });

    expect(released.isOk()).toBe(true);
    expect(released._unsafeUnwrap()).toBe(true);
    const releasedAgain = await registry.releaseLease({ leaseId: paused._unsafeUnwrap().id });
    expect(releasedAgain.isOk()).toBe(true);
    expect(releasedAgain._unsafeUnwrap()).toBe(false);
    const active = await registry.listScopes({ activeOnly: true });
    const history = await registry.listScopes({ activeOnly: false });
    expect(active._unsafeUnwrap()).toHaveLength(0);
    expect(history._unsafeUnwrap()).toHaveLength(1);
    expect(history._unsafeUnwrap()[0]).toMatchObject({
      id: paused._unsafeUnwrap().id,
      active: false,
      updatedBy: 'resume-operator',
    });
  });

  it('extends the exact active lease without shortening it or replacing its policy', async () => {
    await insertOutboxRow(db, {
      id: 'cuo-extend-primary',
      status: 'pending',
      baseId: PRIMARY_BASE_ID,
      seedTableId: PRIMARY_SEED_TABLE_ID,
    });
    const registry = createPauseRegistry(db);
    const originalResumeAt = new Date(Date.now() + 60 * 60 * 1000);
    const paused = await registry.pauseScope({
      scopeType: 'base',
      scopeId: PRIMARY_BASE_ID,
      resumeAt: originalResumeAt,
      reason: 'database maintenance',
      writePolicy: 'block',
      actor: 'pause-operator',
    });
    expect(paused.isOk()).toBe(true);
    const original = paused._unsafeUnwrap();

    const requestedAt = Date.now();
    const extended = await registry.extendLease({
      leaseId: original.id,
      durationMs: 90 * 60 * 1000,
      actor: 'extend-operator',
    });
    expect(extended.isOk()).toBe(true);
    const renewed = extended._unsafeUnwrap()!;
    expect(renewed).toMatchObject({
      id: original.id,
      pausedAt: original.pausedAt,
      pausedBy: 'pause-operator',
      reason: 'database maintenance',
      writePolicy: 'block',
      updatedBy: 'extend-operator',
    });
    expect(renewed.resumeAt!.getTime() - requestedAt).toBeGreaterThanOrEqual(89 * 60 * 1000);
    expect(await readTaskNextRunAt(db, 'cuo-extend-primary')).toEqual(renewed.resumeAt);

    const notShortened = await registry.extendLease({
      leaseId: original.id,
      durationMs: 15 * 60 * 1000,
      actor: 'extend-operator',
    });
    expect(notShortened._unsafeUnwrap()!.resumeAt).toEqual(renewed.resumeAt);
    const stale = await registry.extendLease({
      leaseId: 'cup-stale',
      durationMs: 30 * 60 * 1000,
    });
    expect(stale.isOk()).toBe(true);
    expect(stale._unsafeUnwrap()).toBeNull();
  });

  it('defaults a pause lease to 30 minutes', async () => {
    const registry = createPauseRegistry(db);
    const requestedAt = Date.now();

    const paused = await registry.pauseScope({
      scopeType: 'base',
      scopeId: PRIMARY_BASE_ID,
      actor: 'tester',
    });

    expect(paused.isOk()).toBe(true);
    const resumeAt = paused._unsafeUnwrap().resumeAt;
    expect(resumeAt).not.toBeNull();
    expect(resumeAt!.getTime() - requestedAt).toBeGreaterThanOrEqual(29 * 60 * 1000);
    expect(resumeAt!.getTime() - requestedAt).toBeLessThanOrEqual(31 * 60 * 1000);
  });

  it('rejects expired and overlong pause leases', async () => {
    const registry = createPauseRegistry(db);
    const expired = await registry.pauseScope({
      scopeType: 'base',
      scopeId: PRIMARY_BASE_ID,
      resumeAt: new Date(Date.now() - 60 * 1000),
      actor: 'tester',
    });
    const overlong = await registry.pauseScope({
      scopeType: 'base',
      scopeId: PRIMARY_BASE_ID,
      resumeAt: new Date(Date.now() + 2 * 60 * 60 * 1000 + 60 * 1000),
      actor: 'tester',
    });

    expect(expired.isErr()).toBe(true);
    expect(overlong.isErr()).toBe(true);
  });

  it('discards pending tasks and dead letters for a deleted seed table but spares processing and other tables', async () => {
    const outbox = createTestOutbox(db);
    await insertOutboxRow(db, { id: 'cuo-discard-pending', status: 'pending' });
    await insertDeadLetterRow(db, { id: 'cuo-dead-discard' });
    await insertDeadLetterRow(db, {
      id: 'cuo-dead-other-table',
      seedTableId: PRIMARY_TARGET_TABLE_ID,
    });
    await insertOutboxRow(db, {
      id: 'cuo-discard-chained',
      status: 'pending',
      dirtyStats: { ledgerScopeId: 'cuo-chain-root' },
    });
    await insertOutboxRow(db, {
      id: 'cuo-discard-processing',
      status: 'processing',
      lockedAt: new Date(),
      lockedBy: 'worker-1',
    });
    await insertOutboxRow(db, {
      id: 'cuo-other-table',
      status: 'pending',
      seedTableId: PRIMARY_TARGET_TABLE_ID,
    });
    await insertOutboxRow(db, {
      id: 'cuo-other-base',
      status: 'pending',
      baseId: SECONDARY_BASE_ID,
      seedTableId: SECONDARY_SEED_TABLE_ID,
    });
    await db
      .insertInto('computed_update_outbox_seed')
      .values([
        {
          id: 'seed-1',
          task_id: 'cuo-discard-pending',
          table_id: PRIMARY_SEED_TABLE_ID,
          record_id: 'rec1',
        },
        {
          id: 'seed-2',
          task_id: 'cuo-other-table',
          table_id: PRIMARY_TARGET_TABLE_ID,
          record_id: 'rec1',
        },
      ])
      .execute();
    await db
      .insertInto('computed_update_stage_ledger')
      .values([
        {
          scope_id: 'cuo-discard-pending',
          kind: 'dirty',
          table_id: PRIMARY_SEED_TABLE_ID,
          record_id: 'rec1',
        },
        {
          scope_id: 'cuo-chain-root',
          kind: 'dirty',
          table_id: PRIMARY_SEED_TABLE_ID,
          record_id: 'rec2',
        },
        {
          scope_id: 'cuo-other-table',
          kind: 'dirty',
          table_id: PRIMARY_TARGET_TABLE_ID,
          record_id: 'rec1',
        },
      ])
      .execute();

    const result = await outbox.discardBySeedTable({
      baseId: PRIMARY_BASE_ID,
      seedTableId: PRIMARY_SEED_TABLE_ID,
    });

    expect(result.isOk()).toBe(true);
    expect([...result._unsafeUnwrap().discardedTaskIds].sort()).toEqual([
      'cuo-discard-chained',
      'cuo-discard-pending',
    ]);
    expect(result._unsafeUnwrap().discardedDeadLetterTaskIds).toEqual(['cuo-dead-discard']);

    const remainingDeadLetters = await db
      .selectFrom('computed_update_dead_letter')
      .select(['id'])
      .execute();
    expect(remainingDeadLetters.map((row) => row.id)).toEqual(['cuo-dead-other-table']);

    const remainingTasks = await db.selectFrom('computed_update_outbox').select(['id']).execute();
    expect(remainingTasks.map((row) => row.id).sort()).toEqual([
      'cuo-discard-processing',
      'cuo-other-base',
      'cuo-other-table',
    ]);

    const remainingSeeds = await db
      .selectFrom('computed_update_outbox_seed')
      .select(['task_id'])
      .execute();
    expect(remainingSeeds.map((row) => row.task_id)).toEqual(['cuo-other-table']);

    const remainingLedger = await db
      .selectFrom('computed_update_stage_ledger')
      .select(['scope_id'])
      .execute();
    expect(remainingLedger.map((row) => row.scope_id)).toEqual(['cuo-other-table']);
  });

  it('returns no ids when nothing is pending for the seed table', async () => {
    const outbox = createTestOutbox(db);
    await insertOutboxRow(db, {
      id: 'cuo-still-processing',
      status: 'processing',
      lockedAt: new Date(),
      lockedBy: 'worker-1',
    });

    const result = await outbox.discardBySeedTable({
      baseId: PRIMARY_BASE_ID,
      seedTableId: PRIMARY_SEED_TABLE_ID,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().discardedTaskIds).toEqual([]);
    expect(result._unsafeUnwrap().discardedDeadLetterTaskIds).toEqual([]);
  });

  describe('lineage', () => {
    const buildComputedTaskInput = (
      overrides: Partial<ComputedUpdateOutboxTaskInput> = {}
    ): ComputedUpdateOutboxTaskInput => ({
      baseId: PRIMARY_BASE_ID,
      seedTableId: PRIMARY_SEED_TABLE_ID,
      seedRecordIds: ['rec0000000000000001', 'rec0000000000000002'],
      extraSeedRecords: [],
      beforeImageRecords: [],
      steps: [{ tableId: PRIMARY_TARGET_TABLE_ID, fieldIds: [`fld${'c'.repeat(16)}`], level: 0 }],
      edges: [],
      estimatedComplexity: 2,
      changeType: 'update',
      runId: 'run-lineage',
      originRunIds: [],
      runTotalSteps: 1,
      runCompletedStepsBefore: 0,
      planHash: 'hash-lineage',
      affectedTableIds: [PRIMARY_TARGET_TABLE_ID],
      affectedFieldIds: [`fld${'c'.repeat(16)}`],
      syncMaxLevel: 0,
      ...overrides,
    });

    it('accumulates merged-away seed run ids into origin_run_ids and keeps source_changed_at', async () => {
      const outbox = createTestOutbox(db);
      const changedFieldIds = [FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap()];
      const buildSeed = (runId: string, recordIndex: number) =>
        buildSeedTaskInput({
          baseId: BaseId.create(PRIMARY_BASE_ID)._unsafeUnwrap(),
          seedTableId: TableId.create(PRIMARY_SEED_TABLE_ID)._unsafeUnwrap(),
          seedRecordIds: [createRecordId(recordIndex)],
          extraSeedRecords: [],
          changedFieldIds,
          changeType: 'update',
          hasher: new NoopHasher(),
          runId,
        });

      const first = await outbox.enqueueSeedTask(buildSeed('run-a', 1));
      expect(first.isOk()).toBe(true);
      expect(first._unsafeUnwrap().merged).toBe(false);

      const afterFirst = await db
        .selectFrom('computed_update_outbox')
        .selectAll()
        .where('id', '=', first._unsafeUnwrap().taskId)
        .executeTakeFirstOrThrow();
      expect(afterFirst.source_changed_at).not.toBeNull();

      const second = await outbox.enqueueSeedTask(buildSeed('run-b', 2));
      expect(second.isOk()).toBe(true);
      expect(second._unsafeUnwrap().merged).toBe(true);
      expect(second._unsafeUnwrap().taskId).toBe(first._unsafeUnwrap().taskId);

      const afterMerge = await db
        .selectFrom('computed_update_outbox')
        .selectAll()
        .where('id', '=', first._unsafeUnwrap().taskId)
        .executeTakeFirstOrThrow();
      expect(String(afterMerge.run_id)).toBe('run-a');
      expect(afterMerge.origin_run_ids).toEqual(['run-b']);
      // Merge keeps the first mutation's source-change time.
      expect(new Date(String(afterMerge.source_changed_at)).getTime()).toBe(
        new Date(String(afterFirst.source_changed_at)).getTime()
      );
    });

    it('round-trips stage depth, predecessor and source-changed time on computed tasks', async () => {
      const outbox = createTestOutbox(db);
      const sourceChangedAt = new Date('2026-01-05T11:59:00Z');
      const enqueued = await outbox.enqueueOrMerge(
        buildComputedTaskInput({
          stageDepth: 3,
          sourceChangedAt,
          predecessorTaskId: 'cuo-predecessor',
        })
      );
      expect(enqueued.isOk()).toBe(true);

      const claimed = await outbox.claimById({
        taskId: enqueued._unsafeUnwrap().taskId,
        workerId: 'lineage-worker',
      });
      expect(claimed.isOk()).toBe(true);
      const item = claimed._unsafeUnwrap();
      expect(item).not.toBeNull();
      // Seed/backfill items carry a taskType discriminator; computed items do not.
      if (!item || 'taskType' in item) throw new Error('expected computed task item');
      expect(item.stageDepth).toBe(3);
      expect(item.predecessorTaskId).toBe('cuo-predecessor');
      expect(item.sourceChangedAt?.getTime()).toBe(sourceChangedAt.getTime());
    });

    it('records run history when a computed task completes', async () => {
      const outbox = createTestOutbox(db);
      const sourceChangedAt = new Date('2026-01-05T11:58:00Z');
      const enqueued = await outbox.enqueueOrMerge(
        buildComputedTaskInput({
          planHash: 'hash-lineage-history',
          runId: 'run-history',
          originRunIds: ['run-parent'],
          stageDepth: 2,
          sourceChangedAt,
          predecessorTaskId: 'cuo-history-predecessor',
        })
      );
      expect(enqueued.isOk()).toBe(true);
      const taskId = enqueued._unsafeUnwrap().taskId;

      const claimed = await outbox.claimById({ taskId, workerId: 'lineage-worker' });
      const item = claimed._unsafeUnwrap();
      expect(item).not.toBeNull();

      const done = await outbox.markDone(item!);
      expect(done.isOk()).toBe(true);
      expect(done._unsafeUnwrap()).toBe(true);

      const history = await db
        .selectFrom('computed_update_run_history')
        .selectAll()
        .where('task_id', '=', taskId)
        .executeTakeFirstOrThrow();
      expect(String(history.outcome)).toBe('succeeded');
      expect(String(history.run_id)).toBe('run-history');
      expect(history.origin_run_ids).toEqual(['run-parent']);
      expect(Number(history.stage_depth)).toBe(2);
      expect(String(history.predecessor_task_id)).toBe('cuo-history-predecessor');
      expect(Number(history.seed_record_count)).toBe(2);
      expect(new Date(String(history.source_changed_at)).getTime()).toBe(sourceChangedAt.getTime());
      expect(history.started_at).not.toBeNull();
      expect(history.completed_at).not.toBeNull();
      expect(Number(history.duration_ms)).toBeGreaterThanOrEqual(0);

      const remaining = await db
        .selectFrom('computed_update_outbox')
        .select('id')
        .where('id', '=', taskId)
        .executeTakeFirst();
      expect(remaining).toBeUndefined();
    });
  });

  describe('continuation relay claim', () => {
    const FIELD_ID = `fld${'c'.repeat(16)}`;
    const PREDECESSOR_ID = 'cuo-relay-predecessor';

    const createContinuationInput = (planHash: string): ComputedUpdateOutboxTaskInput => ({
      baseId: PRIMARY_BASE_ID,
      seedTableId: PRIMARY_SEED_TABLE_ID,
      seedRecordIds: ['rec1'],
      extraSeedRecords: [],
      beforeImageRecords: [],
      steps: [{ level: 0, tableId: PRIMARY_SEED_TABLE_ID, fieldIds: [FIELD_ID] }],
      edges: [],
      estimatedComplexity: 1,
      changeType: 'update',
      planHash,
      dirtyStats: [{ tableId: PRIMARY_SEED_TABLE_ID, recordCount: 1 }],
      runId: `run-${planHash}`,
      originRunIds: [],
      runTotalSteps: 2,
      runCompletedStepsBefore: 1,
      stageDepth: 1,
      affectedTableIds: [PRIMARY_SEED_TABLE_ID],
      affectedFieldIds: [FIELD_ID],
      syncMaxLevel: 0,
    });

    const insertPredecessor = async () => {
      await insertOutboxRow(db, {
        id: PREDECESSOR_ID,
        status: 'processing',
        lockedAt: new Date(),
        lockedBy: 'relay-worker:cuc-parent',
      });
    };

    const relayOptions = {
      relayClaim: { workerId: 'relay-worker', predecessorTaskId: PREDECESSOR_ID },
    };

    it('does not access reliability tables for successful enqueue claim and completion with master enabled', async () => {
      vi.stubEnv('COMPUTED_RELIABILITY_ENABLED', 'true');
      vi.stubEnv('COMPUTED_RELIABILITY_UI_ENABLED', 'false');
      vi.stubEnv('COMPUTED_RELIABILITY_BASE_IDS', '');
      const statements: string[] = [];
      const observedDb = db.withPlugin({
        transformQuery(args) {
          const compiled = new PostgresQueryCompiler().compileQuery(args.node);
          // Include bindings: a readiness probe can reference tables through to_regclass($1).
          statements.push(`${compiled.sql} ${JSON.stringify(compiled.parameters)}`);
          return args.node;
        },
        async transformResult(args) {
          return args.result;
        },
      });
      try {
        const outbox = createTestOutbox(observedDb);
        const enqueued = (
          await outbox.enqueueOrMerge({
            ...createContinuationInput('ordinary-success'),
            stageDepth: 0,
            runTotalSteps: 1,
            runCompletedStepsBefore: 0,
          })
        )._unsafeUnwrap();
        const claimed = (
          await outbox.claimById({ taskId: enqueued.taskId, workerId: 'ordinary-worker' })
        )._unsafeUnwrap();
        expect(claimed).not.toBeNull();
        expect((await outbox.markDone(claimed!))._unsafeUnwrap()).toBe(true);
        expect(
          statements.some((statement) => statement.includes('insert into "computed_update_outbox"'))
        ).toBe(true);
        expect(
          statements.some((statement) => statement.includes('update "computed_update_outbox"'))
        ).toBe(true);
        expect(
          statements.some((statement) => statement.includes('delete from "computed_update_outbox"'))
        ).toBe(true);
        expect(
          statements.filter((statement) => statement.includes('computed_reliability_'))
        ).toEqual([]);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('discards source tasks without accessing a reliability ledger denied to the runtime role', async () => {
      for (const statement of computedReliabilitySchemaSql
        .split(';')
        .filter((part) => part.trim())) {
        await sql.raw(statement).execute(db);
      }
      await sql`create role table_drop_worker`.execute(db);
      await sql`grant usage on schema public to table_drop_worker`.execute(db);
      await sql`grant all on all tables in schema public to table_drop_worker`.execute(db);
      await sql`revoke all on computed_reliability_issue,computed_reliability_scope from table_drop_worker`.execute(
        db
      );
      await insertOutboxRow(db, { id: 'source-drop', status: 'pending' });
      const statements: string[] = [];
      const observed = db.withPlugin({
        transformQuery(args) {
          const compiled = new PostgresQueryCompiler().compileQuery(args.node);
          statements.push(`${compiled.sql} ${JSON.stringify(compiled.parameters)}`);
          return args.node;
        },
        async transformResult(args) {
          return args.result;
        },
      });
      vi.stubEnv('COMPUTED_RELIABILITY_ENABLED', 'true');
      try {
        await sql`set role table_drop_worker`.execute(db);
        const result = (
          await createTestOutbox(observed).discardBySeedTable({
            baseId: PRIMARY_BASE_ID,
            seedTableId: PRIMARY_SEED_TABLE_ID,
          })
        )._unsafeUnwrap();
        expect(result.discardedTaskIds).toContain('source-drop');
        expect(
          statements.filter((statement) => statement.includes('computed_reliability_'))
        ).toEqual([]);
      } finally {
        await sql`reset role`.execute(db);
        vi.unstubAllEnvs();
      }
    });

    it('persists failure evidence with unknown scope and field-level rejection', async () => {
      vi.stubEnv('COMPUTED_RELIABILITY_ENABLED', 'true');
      for (const statement of computedReliabilitySchemaSql
        .split(';')
        .filter((part) => part.trim())) {
        await sql.raw(statement).execute(db);
      }
      await sql`create table if not exists computed_task_field_ref(task_id text,field_id text,table_id text)`.execute(
        db
      );
      const store = new PostgresComputedReliabilityStore(db as unknown as Kysely<DynamicDB>);
      await insertOutboxRow(db, {
        id: PREDECESSOR_ID,
        status: 'pending',
        affectedFieldIds: [FIELD_ID],
        affectedTableIds: [PRIMARY_TARGET_TABLE_ID],
      });
      const outbox = createTestOutbox(db, undefined, { runHistoryEnabled: false });
      const parent = (
        await outbox.claimById({ taskId: PREDECESSOR_ID, workerId: 'worker' })
      )._unsafeUnwrap()!;
      expect(
        (await outbox.markFailed(parent, 'timeout', {}, { directDeadLetter: true }))._unsafeUnwrap()
      ).toBe(true);
      expect((await store.listIssues())[0]).toMatchObject({
        task_id: PREDECESSOR_ID,
        status: 'open',
        scope_complete: false,
      });
      // No execution plan/reference identifies the downstream field's table.
      // The durable scope must not guess that it belongs to the seed table.
      expect(await store.getFieldSummaries(PRIMARY_SEED_TABLE_ID)).toEqual([]);
      expect(await store.getUnknownScopeSummary(PRIMARY_SEED_TABLE_ID)).toMatchObject({
        unresolvedCount: 1,
        scopeComplete: false,
      });
      await insertOutboxRow(db, { id: 'field-rejection', status: 'pending' });
      const rejected = (
        await outbox.claimById({ taskId: 'field-rejection', workerId: 'worker' })
      )._unsafeUnwrap()!;
      expect(
        (
          await outbox.markDone(rejected, undefined, {
            fieldErrors: [
              {
                fieldId: FIELD_ID,
                error: {
                  message: 'Cell limit exceeded',
                  context: { tableId: PRIMARY_SEED_TABLE_ID },
                },
              },
            ],
          })
        )._unsafeUnwrap()
      ).toBe(true);
      const rejectionIssue = (await store.listIssues()).find(
        (issue) => issue.task_id === 'field-rejection'
      );
      expect(rejectionIssue).toMatchObject({ status: 'open', scope_complete: true });
      expect(
        (await store.getFieldSummaries(PRIMARY_SEED_TABLE_ID))[0].reliability.unresolvedCount
      ).toBeGreaterThan(0);
      vi.unstubAllEnvs();
    });

    it('claims a fresh continuation inside the enqueue transaction', async () => {
      await insertPredecessor();
      const publisher = new RecordingWakeupPublisher();
      const outbox = createTestOutbox(db, publisher);

      const result = await outbox.enqueueOrMerge(
        createContinuationInput('plan-relay-fresh'),
        undefined,
        relayOptions
      );

      expect(result.isOk()).toBe(true);
      const outcome = result._unsafeUnwrap();
      expect(outcome.merged).toBe(false);
      expect(outcome.claimed).toBeDefined();
      expect(outcome.claimed?.id).toBe(outcome.taskId);
      expect(outcome.claimed?.status).toBe('processing');
      expect(outcome.claimed?.lockedBy).toContain('relay-worker');

      const row = await db
        .selectFrom('computed_update_outbox')
        .select(['status', 'locked_by'])
        .where('id', '=', outcome.taskId)
        .executeTakeFirst();
      expect(row?.status).toBe('processing');
      expect(String(row?.locked_by)).toContain('relay-worker');
      // The crash-safety wakeup is still published.
      expect(publisher.wakeups.map((wakeup) => wakeup.taskId)).toContain(outcome.taskId);
    });

    it('does not relay-claim when the enqueue merges into an existing pending task', async () => {
      await insertPredecessor();
      const outbox = createTestOutbox(db);

      const first = await outbox.enqueueOrMerge(createContinuationInput('plan-relay-merge'));
      expect(first.isOk()).toBe(true);

      const second = await outbox.enqueueOrMerge(
        createContinuationInput('plan-relay-merge'),
        undefined,
        relayOptions
      );
      expect(second.isOk()).toBe(true);
      const outcome = second._unsafeUnwrap();
      expect(outcome.merged).toBe(true);
      expect(outcome.claimed).toBeUndefined();

      const row = await db
        .selectFrom('computed_update_outbox')
        .select(['status'])
        .where('id', '=', outcome.taskId)
        .executeTakeFirst();
      expect(row?.status).toBe('pending');
    });

    it('excludes the predecessor from the concurrency cap', async () => {
      await insertPredecessor();
      // One more active task: active-excluding-predecessor = 1 < cap 2.
      await insertOutboxRow(db, {
        id: 'cuo-relay-other-active',
        status: 'processing',
        seedTableId: SECONDARY_SEED_TABLE_ID,
        lockedAt: new Date(),
        lockedBy: 'other-worker:cuc-1',
      });
      const outbox = createTestOutbox(db);

      const result = await outbox.enqueueOrMerge(
        createContinuationInput('plan-relay-cap-ok'),
        undefined,
        relayOptions
      );
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().claimed?.status).toBe('processing');
    });

    it('leaves the continuation pending when another task for the seed table is active', async () => {
      await insertPredecessor();
      await insertOutboxRow(db, {
        id: 'cuo-relay-same-seed-active',
        status: 'processing',
        seedTableId: PRIMARY_SEED_TABLE_ID,
        lockedAt: new Date(),
        lockedBy: 'other-worker:cuc-1',
      });
      const outbox = createTestOutbox(db);

      const result = await outbox.enqueueOrMerge(
        createContinuationInput('plan-relay-seed-cap-blocked'),
        undefined,
        relayOptions
      );
      expect(result.isOk()).toBe(true);
      const outcome = result._unsafeUnwrap();
      expect(outcome.claimed).toBeUndefined();

      const row = await db
        .selectFrom('computed_update_outbox')
        .select(['status', 'locked_by'])
        .where('id', '=', outcome.taskId)
        .executeTakeFirst();
      expect(row?.status).toBe('pending');
      expect(row?.locked_by).toBeNull();
    });

    it('leaves the continuation pending when the base concurrency cap is reached', async () => {
      await insertPredecessor();
      await insertOutboxRow(db, {
        id: 'cuo-relay-active-1',
        status: 'processing',
        seedTableId: SECONDARY_SEED_TABLE_ID,
        lockedAt: new Date(),
        lockedBy: 'other-worker:cuc-1',
      });
      await insertOutboxRow(db, {
        id: 'cuo-relay-active-2',
        status: 'processing',
        seedTableId: PRIMARY_TARGET_TABLE_ID,
        lockedAt: new Date(),
        lockedBy: 'other-worker:cuc-2',
      });
      const outbox = createTestOutbox(db);

      const result = await outbox.enqueueOrMerge(
        createContinuationInput('plan-relay-cap-blocked'),
        undefined,
        relayOptions
      );
      expect(result.isOk()).toBe(true);
      const outcome = result._unsafeUnwrap();
      expect(outcome.claimed).toBeUndefined();

      const row = await db
        .selectFrom('computed_update_outbox')
        .select(['status', 'locked_by'])
        .where('id', '=', outcome.taskId)
        .executeTakeFirst();
      expect(row?.status).toBe('pending');
      expect(row?.locked_by).toBeNull();
    });

    it('leaves the continuation pending when its scope is paused', async () => {
      await insertPredecessor();
      const registry = createPauseRegistry(db);
      const paused = await registry.pauseScope({
        scopeType: 'base',
        scopeId: PRIMARY_BASE_ID,
        resumeAt: new Date(Date.now() + 60 * 60 * 1000),
        actor: 'tester',
      });
      expect(paused.isOk()).toBe(true);
      const outbox = createTestOutbox(db);

      const result = await outbox.enqueueOrMerge(
        createContinuationInput('plan-relay-paused'),
        undefined,
        relayOptions
      );
      expect(result.isOk()).toBe(true);
      const outcome = result._unsafeUnwrap();
      expect(outcome.claimed).toBeUndefined();

      const row = await db
        .selectFrom('computed_update_outbox')
        .select(['status'])
        .where('id', '=', outcome.taskId)
        .executeTakeFirst();
      expect(row?.status).toBe('pending');
    });

    it('does not relay-claim when disabled by config', async () => {
      await insertPredecessor();
      const outbox = createTestOutbox(db, undefined, { continuationRelayClaimEnabled: false });

      const result = await outbox.enqueueOrMerge(
        createContinuationInput('plan-relay-disabled'),
        undefined,
        relayOptions
      );
      expect(result.isOk()).toBe(true);
      const outcome = result._unsafeUnwrap();
      expect(outcome.claimed).toBeUndefined();

      const row = await db
        .selectFrom('computed_update_outbox')
        .select(['status'])
        .where('id', '=', outcome.taskId)
        .executeTakeFirst();
      expect(row?.status).toBe('pending');
    });

    it('spills relay-claimed seeds to the seed table and loads them back on the claimed item', async () => {
      await insertPredecessor();
      // seedInlineLimit is 0 in the test outbox, so seeds always spill.
      const outbox = createTestOutbox(db);
      const input = {
        ...createContinuationInput('plan-relay-seeds'),
        seedRecordIds: ['rec1', 'rec2', 'rec3'],
      };

      const result = await outbox.enqueueOrMerge(input, undefined, relayOptions);
      expect(result.isOk()).toBe(true);
      const outcome = result._unsafeUnwrap();
      const claimed = outcome.claimed;
      expect(claimed).toBeDefined();
      if (claimed && 'seedRecordIds' in claimed) {
        expect([...claimed.seedRecordIds].sort()).toEqual(['rec1', 'rec2', 'rec3']);
      }
    });
  });
});
