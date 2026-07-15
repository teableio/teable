import { PGlite } from '@electric-sql/pglite';
import { PostgresUnitOfWorkTransaction } from '@teable/v2-adapter-db-postgres-shared';
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
import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest';

import { ComputedUpdatePauseRegistry } from '../../pause/ComputedUpdatePauseRegistry';
import type { ComputedOutboxWakeup, IComputedOutboxWakeupPublisher } from '../ComputedOutboxWakeup';
import { ComputedUpdateOutbox } from '../ComputedUpdateOutbox';
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
      attempts: 0,
      max_attempts: 8,
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
      .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addColumn('updated_by', 'text')
      .execute();

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "computed_update_pause_scope_scope_type_scope_id_key"
      ON "computed_update_pause_scope"("scope_type", "scope_id")
    `.execute(db);
  });

  beforeEach(async () => {
    await db.deleteFrom('computed_update_pause_scope').execute();
    await db.deleteFrom('computed_update_outbox_seed').execute();
    await db.deleteFrom('computed_update_outbox').execute();
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

  it('reports indefinite and scheduled pauses through the claim eligibility seam', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
    try {
      await insertOutboxRow(db, { id: 'cuo-paused-eligibility', status: 'pending' });
      const pauseRegistry = createPauseRegistry(db);
      await pauseRegistry.pauseScope({
        scopeType: 'base',
        scopeId: PRIMARY_BASE_ID,
        actor: 'tester',
      });
      const outbox = createTestOutbox(db);

      const indefinite = await outbox.getTaskClaimEligibility('cuo-paused-eligibility');
      expect(indefinite._unsafeUnwrap()).toEqual({
        status: 'deferred',
        reason: 'paused',
        retryAt: null,
      });

      const resumeAt = new Date('2026-01-05T12:05:00Z');
      await pauseRegistry.pauseScope({
        scopeType: 'base',
        scopeId: PRIMARY_BASE_ID,
        resumeAt,
        actor: 'tester',
      });
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

    const outbox = createTestOutbox(db);
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
    expect(remaining._unsafeUnwrap()).toHaveLength(0);
  });

  it('treats expired pause scopes as inactive in active-only listing', async () => {
    const registry = createPauseRegistry(db);
    const expiredResumeAt = new Date(Date.now() - 60 * 1000);

    await registry.pauseScope({
      scopeType: 'base',
      scopeId: PRIMARY_BASE_ID,
      resumeAt: expiredResumeAt,
      actor: 'tester',
    });

    const activeScopes = await registry.listScopes({ activeOnly: true });
    const allScopes = await registry.listScopes({ activeOnly: false });

    expect(activeScopes.isOk()).toBe(true);
    expect(allScopes.isOk()).toBe(true);
    expect(activeScopes._unsafeUnwrap()).toHaveLength(0);
    expect(allScopes._unsafeUnwrap()).toHaveLength(1);
    expect(allScopes._unsafeUnwrap()[0].active).toBe(false);
  });
});
