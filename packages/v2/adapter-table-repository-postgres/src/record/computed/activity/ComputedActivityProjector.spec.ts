import { getPostgresTransaction } from '@teable/v2-adapter-db-postgres-shared';
import { domainError, err, ok, FieldId, NoopLogger, TableId, type ILogger } from '@teable/v2-core';
import { computedReliabilitySchemaSql } from '@teable/v2-postgres-schema';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely, type KyselyPlugin } from 'kysely';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi, type Mock } from 'vitest';

import { createPGliteDb } from '../../../schema/visitors/__tests__/helpers/createPGliteDb';
import type { DynamicDB } from '../../query-builder';
import { PostgresComputedReliabilityStore } from '../reliability/PostgresComputedReliabilityStore';
import { ComputedActivityProjector } from './ComputedActivityProjector';
import { PostgresComputedActivityReader } from './PostgresComputedActivityReader';

const BASE_ID = `bse${'a'.repeat(16)}`;
const SPACE_ID = `spc${'e'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;
const TABLE_ID_B = `tbl${'z'.repeat(16)}`;
const FIELD_ID = `fld${'c'.repeat(16)}`;
const FIELD_ID_B = `fld${'d'.repeat(16)}`;
const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
const tableIdB = TableId.create(TABLE_ID_B)._unsafeUnwrap();
const fieldId = FieldId.create(FIELD_ID)._unsafeUnwrap();
const fieldIdB = FieldId.create(FIELD_ID_B)._unsafeUnwrap();

const metrics = {
  estimatedComplexity: 2,
  estimatedDirtyRecords: 1,
  hasAllTargetRecords: false,
};

describe('ComputedActivityProjector', () => {
  let db: Kysely<V1TeableDatabase>;
  let projector: ComputedActivityProjector;
  let reader: PostgresComputedActivityReader;

  beforeEach(async () => {
    const pglite = await createPGliteDb();
    db = pglite.db;

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
      .addColumn('queued_at', 'timestamptz')
      .addColumn('started_at', 'timestamptz')
      .addColumn('last_completed_at', 'timestamptz')
      .addColumn('last_duration_ms', 'integer')
      .addColumn('last_error', 'jsonb')
      .addColumn('extensions', 'jsonb')
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
      .createTable('base')
      .addColumn('id', 'text', (column) => column.primaryKey())
      .addColumn('space_id', 'text', (column) => column.notNull())
      .execute();

    await db
      .insertInto('base' as never)
      .values({ id: BASE_ID, space_id: SPACE_ID } as never)
      .execute();

    projector = new ComputedActivityProjector(db, new NoopLogger());
    // Most cases below specify the legacy synchronous behavior. Default-on
    // async projection has its own public-behavior coverage.
    projector.configureAsyncProjection({ enabled: false });
    reader = new PostgresComputedActivityReader(db, projector);
  });

  it('reports unknown impact for a source failure before any field plan exists and honors UI rollback', async () => {
    vi.stubEnv('COMPUTED_RELIABILITY_ENABLED', 'true');
    vi.stubEnv('COMPUTED_RELIABILITY_UI_ENABLED', 'true');
    try {
      for (const statement of computedReliabilitySchemaSql
        .split(';')
        .filter((item) => item.trim())) {
        await sql.raw(statement).execute(db);
      }
      const store = new PostgresComputedReliabilityStore(db as unknown as Kysely<DynamicDB>);
      await store.recordFailure({
        taskId: 'unknown-failure',
        baseId: BASE_ID,
        sourceTableId: TABLE_ID,
        error: 'seed failed',
      });
      const reader = new PostgresComputedActivityReader(db, projector);
      const visible = (await reader.getByTableId(undefined, TABLE_ID, BASE_ID))._unsafeUnwrap();
      expect(visible.fields).toEqual([]);
      expect(visible.diagnostics.reliability).toMatchObject({
        unresolvedCount: 1,
        scopeComplete: false,
      });
      vi.stubEnv('COMPUTED_RELIABILITY_UI_ENABLED', 'false');
      const hidden = (await reader.getByTableId(undefined, TABLE_ID, BASE_ID))._unsafeUnwrap();
      expect(hidden.diagnostics.reliability).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('uses SQL scoped issue counts and marks missing reliability capabilities unavailable', async () => {
    vi.stubEnv('COMPUTED_RELIABILITY_UI_ENABLED', 'true');
    try {
      const unavailable = (await reader.getByTableId(undefined, TABLE_ID, BASE_ID))._unsafeUnwrap();
      expect(unavailable.observationState).toBe('unavailable');
      for (const statement of computedReliabilitySchemaSql.split(';').filter((part) => part.trim()))
        await sql.raw(statement).execute(db);
      const store = new PostgresComputedReliabilityStore(db as unknown as Kysely<DynamicDB>);
      await store.recordFailure({
        taskId: 'shared-incident',
        baseId: BASE_ID,
        sourceTableId: TABLE_ID,
        error: 'failed',
        targets: [
          { tableId: TABLE_ID, fieldId: FIELD_ID },
          { tableId: TABLE_ID, fieldId: FIELD_ID_B },
        ],
      });
      await store.recordFailure({
        taskId: 'unknown-incident',
        baseId: BASE_ID,
        sourceTableId: TABLE_ID,
        error: 'failed',
      });
      const allowed = (
        await reader.getByTableId(undefined, TABLE_ID, BASE_ID, {
          readableFieldIds: [FIELD_ID, FIELD_ID_B],
        })
      )._unsafeUnwrap();
      expect(allowed.fields).toHaveLength(2);
      expect(allowed.diagnostics.reliability?.unresolvedCount).toBe(1);
      expect(allowed.reliabilityIsAccessScoped).toBe(true);
      expect(allowed.observationState).toBe('available');
      const denied = (
        await reader.getByTableId(undefined, TABLE_ID, BASE_ID, { readableFieldIds: [] })
      )._unsafeUnwrap();
      expect(denied.fields).toEqual([]);
      expect(denied.diagnostics.reliability?.unresolvedCount).toBe(0);
      const full = (await reader.getByTableId(undefined, TABLE_ID, BASE_ID))._unsafeUnwrap();
      expect(full.diagnostics.reliability).toMatchObject({
        unresolvedCount: 2,
        scopeComplete: false,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('does not report an unpaused state when interactive pause observation fails', async () => {
    await db.schema.dropTable('computed_update_pause_scope' as never).execute();
    const result = await reader.getByTableId(undefined, TABLE_ID, BASE_ID, {
      budgetMs: 2000,
      includePauseDiagnostics: true,
    });
    expect(result.isErr()).toBe(true);
  });

  it('skips drift scans during a healthy cooldown and heals when the cooldown expires', async () => {
    await ensureOutboxTasks(['cooldown-reference']);
    await projector.onTaskEnqueued({
      taskId: 'cooldown-reference',
      baseId: BASE_ID,
      targets: [{ fieldId, tableId }],
      metrics,
    });
    let observedAt = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => observedAt);
    const reads = vi.spyOn(db, 'selectFrom');
    const repair = vi.spyOn(projector, 'reconcileTable');
    onTestFinished(() => {
      clock.mockRestore();
      reads.mockRestore();
      repair.mockRestore();
    });
    const first = (await reader.getByTableId(undefined, TABLE_ID, BASE_ID))._unsafeUnwrap();
    expect(first.fields[0].status).toBe('queued');
    expect(reads.mock.calls.some(([table]) => table === 'computed_task_field_ref as refs')).toBe(
      true
    );
    expect(repair).not.toHaveBeenCalled();
    await db.deleteFrom('computed_update_outbox' as never).execute();
    reads.mockClear();
    observedAt += 14_999;
    const second = (await reader.getByTableId(undefined, TABLE_ID, BASE_ID))._unsafeUnwrap();
    expect(second.fields[0].status).toBe('queued');
    expect(reads.mock.calls.some(([table]) => table === 'computed_task_field_ref as refs')).toBe(
      false
    );
    expect(repair).not.toHaveBeenCalled();
    observedAt += 1;
    const healed = (await reader.getByTableId(undefined, TABLE_ID, BASE_ID))._unsafeUnwrap();
    expect(reads.mock.calls.some(([table]) => table === 'computed_task_field_ref as refs')).toBe(
      true
    );
    expect(repair).toHaveBeenCalledTimes(1);
    expect(healed.fields[0].status).toBe('idle');
    expect(healed.diagnostics.activeFieldCount).toBe(0);
  });

  it('retains a syncing observation through the cooldown after a failed repair', async () => {
    await ensureOutboxTasks(['lost-reference']);
    await projector.onTaskEnqueued({
      taskId: 'lost-reference',
      baseId: BASE_ID,
      targets: [{ fieldId, tableId }],
      metrics,
    });
    await db.deleteFrom('computed_task_field_ref' as never).execute();
    const repair = vi
      .spyOn(projector, 'reconcileTable')
      .mockResolvedValue(err(domainError.infrastructure({ message: 'repair unavailable' })));
    const first = (await reader.getByTableId(undefined, TABLE_ID, BASE_ID))._unsafeUnwrap();
    expect(first.observationState).toBe('syncing');
    expect(first.reconciliationPerformed).not.toBe(true);
    const second = (await reader.getByTableId(undefined, TABLE_ID, BASE_ID))._unsafeUnwrap();
    expect(second.observationState).toBe('syncing');
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it('rolls back a budgeted repair and restores the connection for the next read', async () => {
    await ensureOutboxTasks(['budget-reference']);
    await projector.onTaskEnqueued({
      taskId: 'budget-reference',
      baseId: BASE_ID,
      targets: [{ fieldId, tableId }],
      metrics,
    });
    await db.deleteFrom('computed_task_field_ref' as never).execute();
    const repair = vi
      .spyOn(projector, 'reconcileTable')
      .mockImplementationOnce(async (_params, context) => {
        const trx = getPostgresTransaction<DynamicDB>(context)!;
        await sql`update computed_field_activity set estimated_dirty_records=9999 where field_id=${FIELD_ID}`.execute(
          trx
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
        await sql`select 1`.execute(trx);
        return ok(null);
      });
    const result = await reader.getByTableId(undefined, TABLE_ID, BASE_ID, { budgetMs: 100 });
    expect(result.isErr()).toBe(true);
    const row = await db
      .selectFrom('computed_field_activity' as never)
      .selectAll()
      .executeTakeFirst();
    expect((row as { estimated_dirty_records?: number }).estimated_dirty_records).not.toBe(9999);
    repair.mockRestore();
    const next = await new PostgresComputedActivityReader(db, projector).getByTableId(
      undefined,
      TABLE_ID,
      BASE_ID,
      { budgetMs: 5000 }
    );
    expect(next.isOk()).toBe(true);
    expect(next._unsafeUnwrap().reconciliationPerformed).toBe(true);
  });

  it('rebuilds a committed failure after losing all in-memory activity events', async () => {
    vi.stubEnv('COMPUTED_RELIABILITY_ENABLED', 'true');
    vi.stubEnv('COMPUTED_RELIABILITY_UI_ENABLED', 'true');
    vi.stubEnv('COMPUTED_RELIABILITY_BASE_IDS', '');
    try {
      for (const statement of computedReliabilitySchemaSql
        .split(';')
        .filter((item) => item.trim())) {
        await sql.raw(statement).execute(db);
      }
      projector.configureAsyncProjection({ enabled: true });
      await ensureOutboxTasks(['lost-failure']);
      await projector.onTaskEnqueued({
        taskId: 'lost-failure',
        baseId: BASE_ID,
        targets: [{ fieldId, tableId }],
        metrics,
      });
      await db.transaction().execute(async (trx) => {
        const store = new PostgresComputedReliabilityStore(trx as unknown as Kysely<DynamicDB>);
        await store.recordFailure({
          taskId: 'lost-failure',
          baseId: BASE_ID,
          sourceTableId: TABLE_ID,
          error: 'private sql error',
        });
        await sql`delete from computed_update_outbox where id='lost-failure'`.execute(trx);
        expect(
          (
            await projector.onTaskFailed({
              taskId: 'lost-failure',
              baseId: BASE_ID,
              terminal: true,
              error: { message: 'private sql error' },
              trx,
            })
          ).isOk()
        ).toBe(true);
      });
      projector.disposeAsyncFlusher();
      const restarted = new ComputedActivityProjector(db, new NoopLogger());
      try {
        const result = await restarted.reconcileTable({ tableId: TABLE_ID, baseId: BASE_ID });
        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()?.fields[0]).toMatchObject({
          fieldId: FIELD_ID,
          status: 'failed',
          reliability: { unresolvedCount: 1 },
        });
        const newReader = new PostgresComputedActivityReader(db, restarted);
        const snapshot = (
          await newReader.getByTableId(undefined, TABLE_ID, BASE_ID)
        )._unsafeUnwrap();
        expect(snapshot.diagnostics.failedFieldCount).toBe(1);
        expect(snapshot.observedAt).toBeDefined();
        restarted.configureAsyncProjection({ enabled: false });
        await ensureOutboxTasks(['unrelated-success']);
        await restarted.onTaskEnqueued({
          taskId: 'unrelated-success',
          baseId: BASE_ID,
          targets: [{ fieldId, tableId }],
          metrics,
        });
        await restarted.onTaskDone({ taskId: 'unrelated-success', baseId: BASE_ID });
        const after = (await newReader.getByTableId(undefined, TABLE_ID, BASE_ID))._unsafeUnwrap();
        expect(after.fields[0]).toMatchObject({
          status: 'failed',
          reliability: { unresolvedCount: 1 },
        });
      } finally {
        restarted.disposeAsyncFlusher();
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  const ensureOutboxTasks = async (taskIds: string[]) => {
    for (const taskId of taskIds) {
      await db
        .insertInto('computed_update_outbox' as never)
        .values({ id: taskId } as never)
        .onConflict((oc) => oc.column('id').doNothing())
        .execute();
    }
  };

  afterEach(async () => {
    await db.destroy();
  });

  it('defaults lifecycle hooks to async projection when the environment is unset', async () => {
    const previous = process.env.COMPUTED_ACTIVITY_ASYNC_PROJECTION;
    delete process.env.COMPUTED_ACTIVITY_ASYNC_PROJECTION;
    const defaultProjector = new ComputedActivityProjector(db, new NoopLogger());
    defaultProjector.configureAsyncProjection({ debounceMs: 60_000 });

    try {
      await ensureOutboxTasks(['task-default-async']);
      const result = await defaultProjector.onTaskEnqueued({
        taskId: 'task-default-async',
        baseId: BASE_ID,
        targets: [{ fieldId, tableId }],
        metrics,
      });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
      expect(
        await db
          .selectFrom('computed_task_field_ref' as never)
          .selectAll()
          .where('task_id' as never, '=', 'task-default-async' as never)
          .execute()
      ).toHaveLength(1);
      expect(
        await db
          .selectFrom('computed_field_activity' as never)
          .selectAll()
          .where('field_id' as never, '=', FIELD_ID as never)
          .executeTakeFirst()
      ).toBeUndefined();
    } finally {
      defaultProjector.disposeAsyncFlusher();
      if (previous === undefined) delete process.env.COMPUTED_ACTIVITY_ASYNC_PROJECTION;
      else process.env.COMPUTED_ACTIVITY_ASYNC_PROJECTION = previous;
    }
  });

  it('keeps an explicit false environment value as the synchronous rollback switch', async () => {
    const previous = process.env.COMPUTED_ACTIVITY_ASYNC_PROJECTION;
    process.env.COMPUTED_ACTIVITY_ASYNC_PROJECTION = 'false';
    const synchronousProjector = new ComputedActivityProjector(db, new NoopLogger());

    try {
      await ensureOutboxTasks(['task-explicit-sync']);
      const result = await synchronousProjector.onTaskEnqueued({
        taskId: 'task-explicit-sync',
        baseId: BASE_ID,
        targets: [{ fieldId, tableId }],
        metrics,
      });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).not.toBeNull();
      expect(
        await db
          .selectFrom('computed_field_activity' as never)
          .selectAll()
          .where('field_id' as never, '=', FIELD_ID as never)
          .executeTakeFirst()
      ).toMatchObject({ status: 'queued', active_task_count: 1 });
    } finally {
      synchronousProjector.disposeAsyncFlusher();
      if (previous === undefined) delete process.env.COMPUTED_ACTIVITY_ASYNC_PROJECTION;
      else process.env.COMPUTED_ACTIVITY_ASYNC_PROJECTION = previous;
    }
  });

  it('batches activity projection writes across many computed fields', async () => {
    let insertQueryCount = 0;
    const plugin = {
      transformQuery(args) {
        if (args.node.kind === 'InsertQueryNode') insertQueryCount += 1;
        return args.node;
      },
      async transformResult(args) {
        return args.result;
      },
    } satisfies KyselyPlugin;
    const batchedProjector = new ComputedActivityProjector(db.withPlugin(plugin), new NoopLogger());
    batchedProjector.configureAsyncProjection({ enabled: false });
    const targets = Array.from({ length: 30 }, (_, index) => ({
      tableId,
      fieldId: FieldId.create(`fld${index.toString(36).padStart(16, '0')}`)._unsafeUnwrap(),
    }));

    const result = await batchedProjector.onTaskEnqueued({
      taskId: 'task-batched',
      baseId: BASE_ID,
      targets,
      metrics,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()?.fields).toHaveLength(30);
    // task refs, missing table/field rows, and changed field/table snapshots.
    expect(insertQueryCount).toBe(5);
  });

  it('keeps a field running until every claimed task finishes', async () => {
    const target = { fieldId, tableId };

    for (const taskId of ['task-1', 'task-2']) {
      await ensureOutboxTasks([taskId]);
      const enqueued = await projector.onTaskEnqueued({
        taskId,
        baseId: BASE_ID,
        targets: [target],
        metrics,
      });
      expect(enqueued.isOk()).toBe(true);
    }

    const claimed = await projector.onTasksClaimed({
      tasks: [
        { taskId: 'task-1', baseId: BASE_ID },
        { taskId: 'task-2', baseId: BASE_ID },
      ],
    });
    expect(claimed.isOk()).toBe(true);

    const afterClaim = await reader.getByTableId(undefined, TABLE_ID);
    expect(afterClaim.isOk()).toBe(true);
    expect(afterClaim._unsafeUnwrap().fields[0]).toMatchObject({
      status: 'running',
      activeTaskCount: 2,
      processingTaskCount: 2,
    });
    expect(afterClaim._unsafeUnwrap().fields[0]?.extensions).toMatchObject({
      batchProgress: { total: 2, completed: 0 },
    });

    const completed = await projector.onTaskDone({ taskId: 'task-1', baseId: BASE_ID });
    expect(completed.isOk()).toBe(true);

    const afterFirstCompletion = await reader.getByTableId(undefined, TABLE_ID);
    expect(afterFirstCompletion.isOk()).toBe(true);
    expect(afterFirstCompletion._unsafeUnwrap().fields[0]).toMatchObject({
      status: 'running',
      activeTaskCount: 1,
      processingTaskCount: 1,
    });
    expect(afterFirstCompletion._unsafeUnwrap().fields[0]?.extensions).toMatchObject({
      batchProgress: { total: 2, completed: 1 },
    });
  });

  it('persists orchestration progress between sequential chunks', async () => {
    const target = { fieldId, tableId };
    const enqueueChunk = async (taskId: string, completed: number) => {
      await ensureOutboxTasks([taskId]);
      return projector.onTaskEnqueued({
        taskId,
        baseId: BASE_ID,
        targets: [target],
        metrics: {
          ...metrics,
          batchProgress: { groupId: 'paste-operation', total: 5, completed },
        },
      });
    };

    expect((await enqueueChunk('task-chunk-1', 0)).isOk()).toBe(true);
    expect((await projector.onTaskDone({ taskId: 'task-chunk-1', baseId: BASE_ID })).isOk()).toBe(
      true
    );
    expect((await enqueueChunk('task-chunk-2', 1)).isOk()).toBe(true);

    const snapshot = await reader.getByTableId(undefined, TABLE_ID);
    expect(snapshot._unsafeUnwrap().fields[0]?.extensions).toMatchObject({
      batchProgress: { groupId: 'paste-operation', total: 5, completed: 1 },
    });
  });

  it('preserves concurrent enqueue projections for the same table', async () => {
    const target = { fieldId, tableId };

    const results = await Promise.all(
      ['task-concurrent-1', 'task-concurrent-2'].map(async (taskId) => {
        await ensureOutboxTasks([taskId]);
        return projector.onTaskEnqueued({
          taskId,
          baseId: BASE_ID,
          targets: [target],
          metrics,
        });
      })
    );
    expect(results.every((result) => result.isOk())).toBe(true);

    const snapshot = await reader.getByTableId(undefined, TABLE_ID);
    expect(snapshot.isOk()).toBe(true);
    expect(snapshot._unsafeUnwrap().fields[0]).toMatchObject({
      status: 'queued',
      activeTaskCount: 2,
    });
  });

  it('rolls back projector-owned transactions when a domain result fails', async () => {
    const now = new Date();
    await ensureOutboxTasks(['task-rollback']);
    await db
      .insertInto('computed_field_activity' as never)
      .values({
        field_id: FIELD_ID,
        table_id: TABLE_ID,
        base_id: BASE_ID,
        status: 'invalid-status',
        active_task_count: 0,
        processing_task_count: 0,
        generation: 0,
        estimated_complexity: 0,
        estimated_dirty_records: 0,
        has_all_target_records: false,
        updated_at: now,
      } as never)
      .execute();

    const result = await projector.onTaskEnqueued({
      taskId: 'task-rollback',
      baseId: BASE_ID,
      targets: [{ fieldId, tableId }],
      metrics,
      now,
    });

    expect(result.isErr()).toBe(true);
    expect(
      await db
        .selectFrom('computed_task_field_ref' as never)
        .selectAll()
        .execute()
    ).toHaveLength(0);
    expect(
      await db
        .selectFrom('computed_table_activity' as never)
        .selectAll()
        .execute()
    ).toHaveLength(0);
  });

  it('heals orphaned queued activity when task refs are already gone', async () => {
    const target = { fieldId, tableId };
    const now = new Date('2026-07-22T02:00:00.000Z');

    await ensureOutboxTasks(['task-orphan-1', 'task-heal-1']);
    expect(
      (
        await projector.onTaskEnqueued({
          taskId: 'task-orphan-1',
          baseId: BASE_ID,
          targets: [target],
          metrics: {
            estimatedComplexity: 9,
            estimatedDirtyRecords: 5,
            hasAllTargetRecords: true,
          },
          now,
        })
      ).isOk()
    ).toBe(true);

    // Simulate a lost activity release: task refs deleted while counters stay queued.
    await db.deleteFrom('computed_task_field_ref' as never).execute();
    await db
      .updateTable('computed_field_activity' as never)
      .set({
        status: 'queued',
        active_task_count: 1,
        processing_task_count: 0,
        estimated_complexity: 9,
        estimated_dirty_records: 5,
        has_all_target_records: true,
        extensions: JSON.stringify({ batchProgress: { total: 3, completed: 2 } }),
        updated_at: now,
      } as never)
      .where('field_id', '=', FIELD_ID)
      .execute();
    await db
      .updateTable('computed_table_activity' as never)
      .set({
        status: 'calculating',
        queued_field_count: 1,
        calculating_field_count: 0,
        estimated_complexity: 9,
        updated_at: now,
      } as never)
      .where('table_id', '=', TABLE_ID)
      .execute();

    // Re-enqueue + release should resync from refs and clear the orphan.
    expect(
      (
        await projector.onTaskEnqueued({
          taskId: 'task-heal-1',
          baseId: BASE_ID,
          targets: [target],
          metrics,
          now,
        })
      ).isOk()
    ).toBe(true);
    expect(
      (await projector.onTaskDone({ taskId: 'task-heal-1', baseId: BASE_ID, now })).isOk()
    ).toBe(true);

    const snapshot = await reader.getByTableId(undefined, TABLE_ID);
    expect(snapshot.isOk()).toBe(true);
    expect(snapshot._unsafeUnwrap().fields[0]).toMatchObject({
      status: 'idle',
      activeTaskCount: 0,
      processingTaskCount: 0,
      estimatedComplexity: 0,
      estimatedDirtyRecords: 0,
      hasAllTargetRecords: false,
    });
    expect(snapshot._unsafeUnwrap().table).toMatchObject({
      status: 'idle',
      queuedFieldCount: 0,
      calculatingFieldCount: 0,
    });
    expect(snapshot._unsafeUnwrap().diagnostics.activeFieldCount).toBe(0);
  });

  it('reconciles orphaned queued activity on table read', async () => {
    const now = new Date(Date.now() - 2 * 60_000);
    await db
      .insertInto('computed_table_activity' as never)
      .values({
        table_id: TABLE_ID,
        base_id: BASE_ID,
        status: 'calculating',
        calculating_field_count: 0,
        queued_field_count: 1,
        estimated_complexity: 9,
        recent_completions: JSON.stringify([]),
        generation: 1,
        updated_at: now,
      } as never)
      .execute();
    await db
      .insertInto('computed_field_activity' as never)
      .values({
        field_id: FIELD_ID,
        table_id: TABLE_ID,
        base_id: BASE_ID,
        status: 'queued',
        active_task_count: 1,
        processing_task_count: 0,
        generation: 3,
        estimated_complexity: 9,
        estimated_dirty_records: 5,
        has_all_target_records: true,
        queued_at: now,
        started_at: now,
        last_completed_at: now,
        last_duration_ms: 148,
        last_error: null,
        extensions: JSON.stringify({ batchProgress: { total: 3, completed: 2 } }),
        updated_at: now,
      } as never)
      .execute();

    const snapshot = await reader.getByTableId(undefined, TABLE_ID);
    expect(snapshot.isOk()).toBe(true);
    expect(snapshot._unsafeUnwrap().fields[0]).toMatchObject({
      status: 'idle',
      activeTaskCount: 0,
      processingTaskCount: 0,
    });
    expect(snapshot._unsafeUnwrap().table).toMatchObject({
      status: 'idle',
      queuedFieldCount: 0,
    });
    expect(snapshot._unsafeUnwrap().diagnostics.activeFieldCount).toBe(0);
  });

  it('heals status-only activity drift when counters and refs are already zero', async () => {
    const now = new Date();
    await db
      .insertInto('computed_table_activity' as never)
      .values({
        table_id: TABLE_ID,
        base_id: BASE_ID,
        status: 'calculating',
        calculating_field_count: 0,
        queued_field_count: 1,
        estimated_complexity: 0,
        recent_completions: JSON.stringify([]),
        generation: 1,
        updated_at: now,
      } as never)
      .execute();
    await db
      .insertInto('computed_field_activity' as never)
      .values({
        field_id: FIELD_ID,
        table_id: TABLE_ID,
        base_id: BASE_ID,
        status: 'queued',
        active_task_count: 0,
        processing_task_count: 0,
        generation: 1,
        estimated_complexity: 0,
        estimated_dirty_records: 0,
        has_all_target_records: false,
        updated_at: now,
      } as never)
      .execute();

    const snapshot = await reader.getByTableId(undefined, TABLE_ID);

    expect(snapshot._unsafeUnwrap().fields[0]).toMatchObject({
      status: 'idle',
      activeTaskCount: 0,
      processingTaskCount: 0,
    });
    expect(snapshot._unsafeUnwrap().table).toMatchObject({
      status: 'idle',
      queuedFieldCount: 0,
      calculatingFieldCount: 0,
    });
  });

  it('drops dangling task refs without outbox rows during table reconcile', async () => {
    const now = new Date(Date.now() - 2 * 60_000);
    await db
      .insertInto('computed_table_activity' as never)
      .values({
        table_id: TABLE_ID,
        base_id: BASE_ID,
        status: 'calculating',
        calculating_field_count: 0,
        queued_field_count: 1,
        estimated_complexity: 9,
        recent_completions: JSON.stringify([]),
        generation: 2,
        updated_at: now,
      } as never)
      .execute();
    await db
      .insertInto('computed_field_activity' as never)
      .values({
        field_id: FIELD_ID,
        table_id: TABLE_ID,
        base_id: BASE_ID,
        status: 'queued',
        active_task_count: 1,
        processing_task_count: 0,
        generation: 4,
        estimated_complexity: 9,
        estimated_dirty_records: 5,
        has_all_target_records: true,
        queued_at: now,
        started_at: null,
        last_completed_at: now,
        last_duration_ms: 148,
        last_error: null,
        extensions: JSON.stringify({ batchProgress: { total: 3, completed: 2 } }),
        updated_at: now,
      } as never)
      .execute();
    await db
      .insertInto('computed_task_field_ref' as never)
      .values({
        task_id: 'cuo-missing-outbox',
        field_id: FIELD_ID,
        table_id: TABLE_ID,
        base_id: BASE_ID,
        was_processing: false,
        created_at: now,
      } as never)
      .execute();

    const snapshot = await reader.getByTableId(undefined, TABLE_ID);
    expect(snapshot.isOk()).toBe(true);
    expect(snapshot._unsafeUnwrap().fields[0]).toMatchObject({
      status: 'idle',
      activeTaskCount: 0,
    });

    const remainingRefs = await db
      .selectFrom('computed_task_field_ref' as never)
      .selectAll()
      .execute();
    expect(remainingRefs).toHaveLength(0);
  });

  it('preserves terminal failed status after release sync', async () => {
    const target = { fieldId, tableId };
    await ensureOutboxTasks(['task-fail-1']);
    expect(
      (
        await projector.onTaskEnqueued({
          taskId: 'task-fail-1',
          baseId: BASE_ID,
          targets: [target],
          metrics,
        })
      ).isOk()
    ).toBe(true);
    expect(
      (
        await projector.onTasksClaimed({
          tasks: [{ taskId: 'task-fail-1', baseId: BASE_ID }],
        })
      ).isOk()
    ).toBe(true);

    expect(
      (
        await projector.onTaskFailed({
          taskId: 'task-fail-1',
          baseId: BASE_ID,
          error: { code: 'computed.failed', message: 'boom' },
          terminal: true,
        })
      ).isOk()
    ).toBe(true);

    const snapshot = await reader.getByTableId(undefined, TABLE_ID);
    expect(snapshot.isOk()).toBe(true);
    expect(snapshot._unsafeUnwrap().fields[0]).toMatchObject({
      status: 'failed',
      activeTaskCount: 0,
      lastError: { code: 'computed.failed', message: 'boom' },
    });
    expect(snapshot._unsafeUnwrap().diagnostics.failedFieldCount).toBe(1);
  });

  it('returns to idle when a retried task later succeeds', async () => {
    const target = { fieldId, tableId };
    await ensureOutboxTasks(['task-retry-success']);
    expect(
      (
        await projector.onTaskEnqueued({
          taskId: 'task-retry-success',
          baseId: BASE_ID,
          targets: [target],
          metrics,
        })
      ).isOk()
    ).toBe(true);
    expect(
      (
        await projector.onTasksClaimed({
          tasks: [{ taskId: 'task-retry-success', baseId: BASE_ID }],
        })
      ).isOk()
    ).toBe(true);

    expect(
      (
        await projector.onTaskFailed({
          taskId: 'task-retry-success',
          baseId: BASE_ID,
          error: { code: 'computed.retry', message: 'retry scheduled' },
          terminal: false,
        })
      ).isOk()
    ).toBe(true);
    const retrySnapshot = await reader.getByTableId(undefined, TABLE_ID);
    expect(retrySnapshot._unsafeUnwrap().fields[0]).toMatchObject({
      status: 'queued',
      activeTaskCount: 1,
      processingTaskCount: 0,
      lastError: { code: 'computed.retry', message: 'retry scheduled' },
      extensions: { batchProgress: { total: 1, completed: 0 } },
    });

    expect(
      (
        await projector.onTasksClaimed({
          tasks: [{ taskId: 'task-retry-success', baseId: BASE_ID }],
        })
      ).isOk()
    ).toBe(true);
    expect(
      (
        await projector.onTaskDone({
          taskId: 'task-retry-success',
          baseId: BASE_ID,
          durationMs: 25,
        })
      ).isOk()
    ).toBe(true);

    const completed = await reader.getByTableId(undefined, TABLE_ID);
    expect(completed._unsafeUnwrap().fields[0]).toMatchObject({
      status: 'idle',
      activeTaskCount: 0,
      processingTaskCount: 0,
      lastError: null,
      lastDurationMs: 25,
    });
    expect(completed._unsafeUnwrap().table?.recentCompletions[0]).toMatchObject({
      taskId: 'task-retry-success',
      durationMs: 25,
    });
  });

  it('does not reconcile a stable terminal failure on every read', async () => {
    const target = { fieldId, tableId };
    await ensureOutboxTasks(['task-stable-failure']);
    await projector.onTaskEnqueued({
      taskId: 'task-stable-failure',
      baseId: BASE_ID,
      targets: [target],
      metrics,
    });
    await projector.onTasksClaimed({
      tasks: [{ taskId: 'task-stable-failure', baseId: BASE_ID }],
    });
    await projector.onTaskFailed({
      taskId: 'task-stable-failure',
      baseId: BASE_ID,
      error: { code: 'computed.failed', message: 'terminal' },
      terminal: true,
    });
    const reconcile = vi.spyOn(projector, 'reconcileTable');

    await reader.getByTableId(undefined, TABLE_ID);
    await reader.getByTableId(undefined, TABLE_ID);

    expect(reconcile).not.toHaveBeenCalled();
  });

  it('heals table-only calculating state with no active field rows', async () => {
    const now = new Date(Date.now() - 2 * 60_000);
    await db
      .insertInto('computed_table_activity' as never)
      .values({
        table_id: TABLE_ID,
        base_id: BASE_ID,
        status: 'calculating',
        calculating_field_count: 1,
        queued_field_count: 0,
        estimated_complexity: 4,
        recent_completions: JSON.stringify([]),
        generation: 9,
        updated_at: now,
      } as never)
      .execute();

    const snapshot = await reader.getByTableId(undefined, TABLE_ID);
    expect(snapshot.isOk()).toBe(true);
    expect(snapshot._unsafeUnwrap().table).toMatchObject({
      status: 'idle',
      calculatingFieldCount: 0,
      queuedFieldCount: 0,
    });
    expect(snapshot._unsafeUnwrap().diagnostics.activeFieldCount).toBe(0);
  });

  it('keeps a single generation step on enqueue without double bump', async () => {
    const target = { fieldId, tableId };
    await ensureOutboxTasks(['task-gen-1']);
    expect(
      (
        await projector.onTaskEnqueued({
          taskId: 'task-gen-1',
          baseId: BASE_ID,
          targets: [target],
          metrics,
        })
      ).isOk()
    ).toBe(true);

    // Read without reconcile path: query projector-persisted rows directly via reader after making
    // the snapshot fresh so shouldReconcile skips healing.
    const snapshot = await reader.getByTableId(undefined, TABLE_ID);
    expect(snapshot.isOk()).toBe(true);
    expect(snapshot._unsafeUnwrap().fields[0]).toMatchObject({
      status: 'queued',
      activeTaskCount: 1,
      generation: 1,
    });
    expect(snapshot._unsafeUnwrap().table?.generation).toBe(1);
  });

  it('heals idle projection that still has dangling task refs', async () => {
    const now = new Date();
    await db
      .insertInto('computed_table_activity' as never)
      .values({
        table_id: TABLE_ID,
        base_id: BASE_ID,
        status: 'idle',
        calculating_field_count: 0,
        queued_field_count: 0,
        estimated_complexity: 0,
        recent_completions: JSON.stringify([]),
        generation: 1,
        updated_at: now,
      } as never)
      .execute();
    await db
      .insertInto('computed_field_activity' as never)
      .values({
        field_id: FIELD_ID,
        table_id: TABLE_ID,
        base_id: BASE_ID,
        status: 'idle',
        active_task_count: 0,
        processing_task_count: 0,
        generation: 1,
        estimated_complexity: 9,
        estimated_dirty_records: 5,
        has_all_target_records: true,
        queued_at: null,
        started_at: null,
        last_completed_at: null,
        last_duration_ms: null,
        last_error: null,
        extensions: JSON.stringify({ batchProgress: { total: 3, completed: 2 } }),
        updated_at: now,
      } as never)
      .execute();
    await db
      .insertInto('computed_task_field_ref' as never)
      .values({
        task_id: 'cuo-idle-dangling',
        field_id: FIELD_ID,
        table_id: TABLE_ID,
        base_id: BASE_ID,
        was_processing: false,
        created_at: now,
      } as never)
      .execute();

    const snapshot = await reader.getByTableId(undefined, TABLE_ID);
    expect(snapshot.isOk()).toBe(true);
    expect(snapshot._unsafeUnwrap().fields[0]).toMatchObject({
      status: 'idle',
      estimatedComplexity: 0,
      estimatedDirtyRecords: 0,
      hasAllTargetRecords: false,
      extensions: {},
    });
    const remainingRefs = await db
      .selectFrom('computed_task_field_ref' as never)
      .selectAll()
      .execute();
    expect(remainingRefs).toHaveLength(0);
  });

  it('re-syncs an idle projection from a live task ref', async () => {
    const now = new Date();
    await ensureOutboxTasks(['task-live-ref']);
    await db
      .insertInto('computed_table_activity' as never)
      .values({
        table_id: TABLE_ID,
        base_id: BASE_ID,
        status: 'idle',
        calculating_field_count: 0,
        queued_field_count: 0,
        estimated_complexity: 0,
        recent_completions: JSON.stringify([]),
        generation: 1,
        updated_at: now,
      } as never)
      .execute();
    await db
      .insertInto('computed_field_activity' as never)
      .values({
        field_id: FIELD_ID,
        table_id: TABLE_ID,
        base_id: BASE_ID,
        status: 'idle',
        active_task_count: 0,
        processing_task_count: 0,
        generation: 1,
        estimated_complexity: 0,
        estimated_dirty_records: 0,
        has_all_target_records: false,
        updated_at: now,
      } as never)
      .execute();
    await db
      .insertInto('computed_task_field_ref' as never)
      .values({
        task_id: 'task-live-ref',
        field_id: FIELD_ID,
        table_id: TABLE_ID,
        base_id: BASE_ID,
        was_processing: false,
        created_at: now,
      } as never)
      .execute();

    const snapshot = await reader.getByTableId(undefined, TABLE_ID);

    expect(snapshot._unsafeUnwrap().fields[0]).toMatchObject({
      status: 'queued',
      activeTaskCount: 1,
      processingTaskCount: 0,
    });
    expect(snapshot._unsafeUnwrap().table).toMatchObject({
      status: 'calculating',
      queuedFieldCount: 1,
    });
  });

  it('heals a stuck field while another field still has a healthy ref', async () => {
    const now = new Date();
    await ensureOutboxTasks(['task-field-b']);
    await db
      .insertInto('computed_table_activity' as never)
      .values({
        table_id: TABLE_ID,
        base_id: BASE_ID,
        status: 'calculating',
        calculating_field_count: 0,
        queued_field_count: 2,
        estimated_complexity: 2,
        recent_completions: JSON.stringify([]),
        generation: 1,
        updated_at: now,
      } as never)
      .execute();
    for (const fieldIdValue of [FIELD_ID, FIELD_ID_B]) {
      await db
        .insertInto('computed_field_activity' as never)
        .values({
          field_id: fieldIdValue,
          table_id: TABLE_ID,
          base_id: BASE_ID,
          status: 'queued',
          active_task_count: 1,
          processing_task_count: 0,
          generation: 1,
          estimated_complexity: 1,
          estimated_dirty_records: 1,
          has_all_target_records: false,
          updated_at: now,
        } as never)
        .execute();
    }
    await db
      .insertInto('computed_task_field_ref' as never)
      .values({
        task_id: 'task-field-b',
        field_id: FIELD_ID_B,
        table_id: TABLE_ID,
        base_id: BASE_ID,
        was_processing: false,
        created_at: now,
      } as never)
      .execute();

    const snapshot = await reader.getByTableId(undefined, TABLE_ID);
    const fields = new Map(snapshot._unsafeUnwrap().fields.map((field) => [field.fieldId, field]));

    expect(fields.get(FIELD_ID)).toMatchObject({ status: 'idle', activeTaskCount: 0 });
    expect(fields.get(FIELD_ID_B)).toMatchObject({ status: 'queued', activeTaskCount: 1 });
    expect(snapshot._unsafeUnwrap().table).toMatchObject({
      status: 'calculating',
      queuedFieldCount: 1,
    });
  });

  it('reports effective table, base, and space pauses with the distinct pending backlog', async () => {
    const oldestQueuedAt = new Date('2026-07-19T16:26:52.088Z');
    const secondQueuedAt = new Date('2026-07-20T10:00:00.000Z');
    const processingCreatedAt = new Date('2026-07-18T10:00:00.000Z');
    const secondFieldId = FieldId.create(FIELD_ID_B)._unsafeUnwrap();
    const tasks = [
      { id: 'task-paused-oldest', status: 'pending', created_at: oldestQueuedAt },
      { id: 'task-paused-second', status: 'pending', created_at: secondQueuedAt },
      { id: 'task-already-processing', status: 'processing', created_at: processingCreatedAt },
    ];
    await db
      .insertInto('computed_update_outbox' as never)
      .values(tasks as never)
      .execute();

    await projector.onTaskEnqueued({
      taskId: 'task-paused-oldest',
      baseId: BASE_ID,
      targets: [
        { tableId, fieldId },
        { tableId, fieldId: secondFieldId },
      ],
      metrics,
    });
    await projector.onTaskEnqueued({
      taskId: 'task-paused-second',
      baseId: BASE_ID,
      targets: [{ tableId, fieldId }],
      metrics,
    });
    await projector.onTaskEnqueued({
      taskId: 'task-already-processing',
      baseId: BASE_ID,
      targets: [{ tableId, fieldId }],
      metrics,
    });

    await db
      .insertInto('computed_update_pause_scope' as never)
      .values([
        {
          id: 'cup-space',
          scope_type: 'space',
          scope_id: SPACE_ID,
          paused_at: new Date('2026-07-19T14:00:00.000Z'),
          paused_by: 'migration-worker',
          resume_at: new Date('2099-01-01T00:00:00.000Z'),
          reason: 'space migration',
        },
        {
          id: 'cup-base',
          scope_type: 'base',
          scope_id: BASE_ID,
          paused_at: new Date('2026-07-19T15:00:00.000Z'),
          paused_by: 'ops',
          resume_at: null,
          reason: 'base maintenance',
        },
        {
          id: 'cup-table',
          scope_type: 'table',
          scope_id: TABLE_ID,
          paused_at: new Date('2026-07-19T16:00:00.000Z'),
          paused_by: 'ops',
          resume_at: new Date('2099-01-01T00:00:00.000Z'),
          reason: 'table maintenance',
        },
        {
          id: 'cup-table-expired',
          scope_type: 'table',
          scope_id: TABLE_ID,
          paused_at: new Date('2026-07-18T16:00:00.000Z'),
          paused_by: 'old-ops',
          resume_at: new Date('2026-07-18T17:00:00.000Z'),
          reason: 'expired maintenance',
        },
      ] as never)
      .execute();

    const snapshot = await reader.getByTableId(undefined, TABLE_ID, BASE_ID, {
      budgetMs: 2000,
      includePauseDiagnostics: true,
    });

    expect(snapshot._unsafeUnwrap().diagnostics).toMatchObject({
      executionState: 'paused',
      pause: {
        effective: true,
        queuedTaskCount: 2,
        oldestQueuedAt: oldestQueuedAt.toISOString(),
        blockers: [
          {
            id: 'cup-space',
            scopeType: 'space',
            scopeId: SPACE_ID,
            pausedAt: '2026-07-19T14:00:00.000Z',
            pausedBy: 'migration-worker',
            resumeAt: '2099-01-01T00:00:00.000Z',
            reason: 'space migration',
          },
          {
            id: 'cup-base',
            scopeType: 'base',
            scopeId: BASE_ID,
          },
          {
            id: 'cup-table',
            scopeType: 'table',
            scopeId: TABLE_ID,
          },
        ],
      },
    });
  });

  describe('projectStageSettlement', () => {
    const doneTarget = { fieldId, tableId };

    /** Seeds a predecessor task that is enqueued and claimed the normal way. */
    const seedPredecessorTask = async (taskId: string) => {
      await ensureOutboxTasks([taskId]);
      const enqueued = await projector.onTaskEnqueued({
        taskId,
        baseId: BASE_ID,
        targets: [doneTarget],
        metrics,
      });
      expect(enqueued.isOk()).toBe(true);
      const claimed = await projector.onTasksClaimed({ tasks: [{ taskId, baseId: BASE_ID }] });
      expect(claimed.isOk()).toBe(true);
    };

    /** Records the advisory-lock keys a projector call requests, while still executing for real. */
    const recordAdvisoryLockKeys = (target: Kysely<V1TeableDatabase>) => {
      const keys: string[] = [];
      const proxy = new Proxy(target, {
        get(inner, prop) {
          if (prop === 'executeQuery') {
            return async (compiledQuery: { sql: string; parameters: readonly unknown[] }) => {
              if (compiledQuery.sql.includes('pg_try_advisory_xact_lock')) {
                const key = compiledQuery.parameters[0];
                if (typeof key === 'string') keys.push(key);
              }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return (inner as any).executeQuery(compiledQuery);
            };
          }
          const value = Reflect.get(inner, prop);
          return typeof value === 'function' ? value.bind(inner) : value;
        },
      });
      return { trx: proxy as never, keys };
    };

    it('inserts continuation refs, marks the relay-claim processing, and releases the predecessor in one call', async () => {
      await seedPredecessorTask('task-settle-prev');
      await ensureOutboxTasks(['task-settle-next']);

      const result = await projector.projectStageSettlement({
        done: { taskId: 'task-settle-prev', baseId: BASE_ID, durationMs: 42 },
        enqueued: {
          taskId: 'task-settle-next',
          baseId: BASE_ID,
          targets: [doneTarget],
          metrics,
        },
        claimed: [{ taskId: 'task-settle-next', baseId: BASE_ID }],
      });
      expect(result.isOk()).toBe(true);

      const refs = await db
        .selectFrom('computed_task_field_ref' as never)
        .selectAll()
        .execute();
      expect(refs).toHaveLength(1);
      expect((refs[0] as { task_id: string }).task_id).toBe('task-settle-next');
      expect((refs[0] as { was_processing: boolean }).was_processing).toBe(true);

      const snapshot = await reader.getByTableId(undefined, TABLE_ID);
      expect(snapshot._unsafeUnwrap().fields[0]).toMatchObject({
        status: 'running',
        activeTaskCount: 1,
        processingTaskCount: 1,
      });
    });

    it('settles a done-only call (no continuation) the same as onTaskDone', async () => {
      await seedPredecessorTask('task-settle-lone');

      const result = await projector.projectStageSettlement({
        done: { taskId: 'task-settle-lone', baseId: BASE_ID },
      });
      expect(result.isOk()).toBe(true);

      const refs = await db
        .selectFrom('computed_task_field_ref' as never)
        .selectAll()
        .execute();
      expect(refs).toHaveLength(0);

      const snapshot = await reader.getByTableId(undefined, TABLE_ID);
      expect(snapshot._unsafeUnwrap().fields[0]).toMatchObject({
        status: 'idle',
        activeTaskCount: 0,
        processingTaskCount: 0,
      });
    });

    it('stamps isolated cell-limit field errors on a successful done settlement', async () => {
      await seedPredecessorTask('task-settle-limit');

      const result = await projector.projectStageSettlement({
        done: {
          taskId: 'task-settle-limit',
          baseId: BASE_ID,
          fieldErrors: [
            {
              fieldId: FIELD_ID,
              error: {
                code: 'validation.limit.computed_cell_value_max_bytes',
                message:
                  'Computed cell value is too large (12 / 1 bytes). Shorten the source data or change the formula.',
                context: { attempted: 12, max: 1 },
              },
            },
          ],
        },
      });
      expect(result.isOk()).toBe(true);

      const snapshot = await reader.getByTableId(undefined, TABLE_ID);
      expect(snapshot._unsafeUnwrap().fields[0]).toMatchObject({
        status: 'failed',
        activeTaskCount: 0,
        lastError: {
          code: 'validation.limit.computed_cell_value_max_bytes',
          context: { attempted: 12, max: 1 },
        },
      });
    });

    it('produces the same terminal per-field state as three separate calls', async () => {
      // Combined path: predecessor task-a-prev completes while task-a-next is
      // enqueued and relay-claimed for field A, all in one projectStageSettlement call.
      await seedPredecessorTask('task-a-prev');
      await ensureOutboxTasks(['task-a-next']);
      const combined = await projector.projectStageSettlement({
        done: { taskId: 'task-a-prev', baseId: BASE_ID },
        enqueued: { taskId: 'task-a-next', baseId: BASE_ID, targets: [doneTarget], metrics },
        claimed: [{ taskId: 'task-a-next', baseId: BASE_ID }],
      });
      expect(combined.isOk()).toBe(true);

      // Separate-calls path: the same lifecycle for field B via the three
      // independent methods projectStageSettlement replaces.
      await ensureOutboxTasks(['task-b-prev']);
      const targetB = { fieldId: fieldIdB, tableId };
      await projector.onTaskEnqueued({
        taskId: 'task-b-prev',
        baseId: BASE_ID,
        targets: [targetB],
        metrics,
      });
      await projector.onTasksClaimed({ tasks: [{ taskId: 'task-b-prev', baseId: BASE_ID }] });
      await ensureOutboxTasks(['task-b-next']);
      await projector.onTaskEnqueued({
        taskId: 'task-b-next',
        baseId: BASE_ID,
        targets: [targetB],
        metrics,
      });
      await projector.onTasksClaimed({ tasks: [{ taskId: 'task-b-next', baseId: BASE_ID }] });
      const separateDone = await projector.onTaskDone({ taskId: 'task-b-prev', baseId: BASE_ID });
      expect(separateDone.isOk()).toBe(true);

      const snapshot = await reader.getByTableId(undefined, TABLE_ID);
      const fieldA = snapshot._unsafeUnwrap().fields.find((field) => field.fieldId === FIELD_ID);
      const fieldB = snapshot._unsafeUnwrap().fields.find((field) => field.fieldId === FIELD_ID_B);
      expect(fieldA).toMatchObject({
        status: fieldB?.status,
        activeTaskCount: fieldB?.activeTaskCount,
        processingTaskCount: fieldB?.processingTaskCount,
      });
    });

    it('locks the union of tables when done and enqueued targets span different tables', async () => {
      await seedPredecessorTask('task-union-prev');
      await ensureOutboxTasks(['task-union-next']);
      const { trx, keys } = recordAdvisoryLockKeys(db);

      const result = await projector.projectStageSettlement({
        done: { taskId: 'task-union-prev', baseId: BASE_ID },
        enqueued: {
          taskId: 'task-union-next',
          baseId: BASE_ID,
          targets: [{ fieldId: fieldIdB, tableId: tableIdB }],
          metrics,
        },
        trx,
      });
      expect(result.isOk()).toBe(true);
      expect(keys).toEqual(
        expect.arrayContaining([
          `v2:computed-activity:table:${TABLE_ID}`,
          `v2:computed-activity:table:${TABLE_ID_B}`,
        ])
      );

      const doneTableSnapshot = await reader.getByTableId(undefined, TABLE_ID);
      expect(
        doneTableSnapshot._unsafeUnwrap().fields.find((field) => field.fieldId === FIELD_ID)
      ).toMatchObject({ status: 'idle', activeTaskCount: 0 });
      const nextTableSnapshot = await reader.getByTableId(undefined, TABLE_ID_B);
      expect(
        nextTableSnapshot._unsafeUnwrap().fields.find((field) => field.fieldId === FIELD_ID_B)
      ).toMatchObject({ status: 'queued', activeTaskCount: 1 });
    });

    it('skips the whole settlement (no writes) when the advisory lock stays busy', async () => {
      vi.useFakeTimers();
      try {
        await seedPredecessorTask('task-settle-timeout-prev');
        await ensureOutboxTasks(['task-settle-timeout-next']);
        const executeQuery = vi.fn(async () => ({ rows: [{ locked: false }] }));

        const pending = projector.projectStageSettlement({
          done: { taskId: 'task-settle-timeout-prev', baseId: BASE_ID },
          enqueued: {
            taskId: 'task-settle-timeout-next',
            baseId: BASE_ID,
            targets: [doneTarget],
            metrics,
          },
          claimed: [{ taskId: 'task-settle-timeout-next', baseId: BASE_ID }],
          trx: overrideExecuteQuery(executeQuery),
        });
        await vi.advanceTimersByTimeAsync(6_000);
        const result = await pending;
        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toBeNull();
        expect(executeQuery).toHaveBeenCalled();

        // The predecessor's ref is untouched: the whole settlement was skipped.
        const refs = await db
          .selectFrom('computed_task_field_ref' as never)
          .selectAll()
          .execute();
        expect(refs).toHaveLength(1);
        expect((refs[0] as { task_id: string }).task_id).toBe('task-settle-timeout-prev');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('reads and heals activity through a schema-scoped database', async () => {
    const dataSchema = 'teable_byodb_activity';
    const activityTables = [
      'computed_field_activity',
      'computed_table_activity',
      'computed_task_field_ref',
      'computed_update_outbox',
      'computed_update_pause_scope',
    ] as const;

    await sql.raw(`create schema "${dataSchema}"`).execute(db);
    for (const tableName of activityTables) {
      await sql
        .raw(
          `create table "${dataSchema}"."${tableName}" (like "public"."${tableName}" including all)`
        )
        .execute(db);
    }

    const dataDb = db.withSchema(dataSchema) as Kysely<V1TeableDatabase>;
    const dataProjector = new ComputedActivityProjector(dataDb, new NoopLogger());
    const metaDb = db.withSchema('public') as Kysely<V1TeableDatabase>;
    const dataReader = new PostgresComputedActivityReader(dataDb, dataProjector, metaDb);
    const now = new Date();

    await dataDb
      .insertInto('computed_table_activity' as never)
      .values({
        table_id: TABLE_ID,
        base_id: BASE_ID,
        status: 'idle',
        calculating_field_count: 0,
        queued_field_count: 0,
        estimated_complexity: 0,
        recent_completions: JSON.stringify([]),
        generation: 1,
        updated_at: now,
      } as never)
      .execute();
    await dataDb
      .insertInto('computed_field_activity' as never)
      .values({
        field_id: FIELD_ID,
        table_id: TABLE_ID,
        base_id: BASE_ID,
        status: 'queued',
        active_task_count: 1,
        processing_task_count: 0,
        generation: 1,
        estimated_complexity: 1,
        estimated_dirty_records: 1,
        has_all_target_records: false,
        updated_at: now,
      } as never)
      .execute();
    await dataDb
      .insertInto('computed_task_field_ref' as never)
      .values({
        task_id: 'cuo-byodb-dangling',
        field_id: FIELD_ID,
        table_id: TABLE_ID,
        base_id: BASE_ID,
        was_processing: false,
        created_at: now,
      } as never)
      .execute();

    await sql.raw('set search_path to pg_catalog').execute(db);
    try {
      const snapshot = await dataReader.getByTableId(undefined, TABLE_ID);
      expect(snapshot.isOk()).toBe(true);
      expect(snapshot._unsafeUnwrap().fields[0]).toMatchObject({
        fieldId: FIELD_ID,
        status: 'idle',
        activeTaskCount: 0,
      });
      expect(snapshot._unsafeUnwrap().table).toMatchObject({
        status: 'idle',
        queuedFieldCount: 0,
      });

      const remainingRefs = await dataDb
        .selectFrom('computed_task_field_ref' as never)
        .selectAll()
        .execute();
      expect(remainingRefs).toHaveLength(0);
    } finally {
      await sql.raw('set search_path to public').execute(db);
      await sql.raw(`drop schema "${dataSchema}" cascade`).execute(db);
    }
  });

  const overrideExecuteQuery = (executeQuery: (...args: never[]) => unknown) =>
    new Proxy(db, {
      get(target, prop) {
        if (prop === 'executeQuery') return executeQuery;
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as never;

  it('skips the projection instead of waiting forever when the activity advisory lock stays busy', async () => {
    vi.useFakeTimers();
    try {
      // A trx whose try-lock never succeeds: the bounded wait must give up and skip the
      // projection before touching any activity table, leaving the transaction healthy.
      const executeQuery = vi.fn(async () => ({ rows: [{ locked: false }] }));
      const pending = projector.onTaskEnqueued({
        taskId: 'task-lock-timeout',
        baseId: BASE_ID,
        targets: [{ fieldId, tableId }],
        metrics,
        trx: overrideExecuteQuery(executeQuery),
      });
      await vi.advanceTimersByTimeAsync(6_000);
      const result = await pending;
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
      expect(executeQuery).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after a single lock attempt when reconcileTable is called with lockTimeoutMs 0', async () => {
    // Read-path healing must not park its pool connection on a contended lock:
    // a contended lock means another connection is already reconciling, so one
    // failed try-lock and an ok(null) is the whole interaction.
    const executeQuery = vi.fn(async () => ({ rows: [{ locked: false }] }));
    const result = await projector.reconcileTable({
      tableId: tableId.toString(),
      baseId: BASE_ID,
      trx: overrideExecuteQuery(executeQuery),
      lockTimeoutMs: 0,
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
    expect(executeQuery).toHaveBeenCalledTimes(1);
  });

  it('retries a busy advisory lock at millisecond cadence before backing off to the cap', async () => {
    vi.useFakeTimers();
    try {
      // A briefly-held lock must be re-tried well inside the first 250ms quantum; a fixed
      // coarse interval would have attempted only twice by the 100ms mark.
      const executeQuery = vi.fn(async () => ({ rows: [{ locked: false }] }));
      const pending = projector.onTaskEnqueued({
        taskId: 'task-lock-backoff',
        baseId: BASE_ID,
        targets: [{ fieldId, tableId }],
        metrics,
        trx: overrideExecuteQuery(executeQuery),
      });
      await vi.advanceTimersByTimeAsync(100);
      // Doubling from 5ms: attempts at 0, 5, 15, 35, 75ms — five tries within 100ms.
      expect(executeQuery.mock.calls.length).toBeGreaterThanOrEqual(5);
      await vi.advanceTimersByTimeAsync(6_000);
      const result = await pending;
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips the enqueue projection when the in-process gate is held past the timeout', async () => {
    vi.useFakeTimers();
    try {
      // The holder parks inside its projection (advisory-lock query never returns), so the
      // per-table gate stays occupied. The next enqueue must bail out via the gate timeout
      // instead of idling in its caller's transaction indefinitely.
      const neverResolves = new Promise(() => {});
      const holder = projector.onTaskEnqueued({
        taskId: 'task-gate-holder',
        baseId: BASE_ID,
        targets: [{ fieldId, tableId }],
        metrics,
        trx: overrideExecuteQuery(vi.fn(() => neverResolves)),
      });
      const blocked = projector.onTaskEnqueued({
        taskId: 'task-gate-blocked',
        baseId: BASE_ID,
        targets: [{ fieldId, tableId }],
        metrics,
      });
      await vi.advanceTimersByTimeAsync(16_000);
      const result = await blocked;
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
      void holder;
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconciles live refs whose activity rows were never created', async () => {
    // Async-projection events can die with the pod before their first flush,
    // leaving refs without activity rows. Reconcile must surface that work.
    await ensureOutboxTasks(['task-ghost-1']);
    await db
      .insertInto('computed_task_field_ref' as never)
      .values({
        task_id: 'task-ghost-1',
        field_id: FIELD_ID,
        table_id: TABLE_ID,
        base_id: BASE_ID,
        was_processing: false,
        created_at: new Date(),
      } as never)
      .execute();

    const reconciled = await projector.reconcileTable({ tableId: TABLE_ID, baseId: BASE_ID });
    expect(reconciled.isOk()).toBe(true);

    const row = (await db
      .selectFrom('computed_field_activity' as never)
      .selectAll()
      .where('field_id' as never, '=', FIELD_ID as never)
      .executeTakeFirst()) as Record<string, unknown> | undefined;
    expect(row).toMatchObject({
      status: 'queued',
      active_task_count: 1,
      processing_task_count: 0,
    });
  });

  describe('async projection mode', () => {
    const fieldRow = async () =>
      db
        .selectFrom('computed_field_activity' as never)
        .selectAll()
        .where('field_id' as never, '=', FIELD_ID as never)
        .executeTakeFirst() as Promise<Record<string, unknown> | undefined>;
    const refRows = async () =>
      db
        .selectFrom('computed_task_field_ref' as never)
        .selectAll()
        .execute() as Promise<Array<Record<string, unknown>>>;

    beforeEach(() => {
      // Huge debounce so nothing flushes behind the test's back (pglite is a
      // single session); every flush happens via flushAllPendingActivity().
      projector.configureAsyncProjection({ enabled: true, debounceMs: 60_000 });
    });

    it('writes only the refs ledger in the hook transaction and projects on flush', async () => {
      const target = { fieldId, tableId };
      await ensureOutboxTasks(['task-async-1']);
      const enqueued = await projector.onTaskEnqueued({
        taskId: 'task-async-1',
        baseId: BASE_ID,
        targets: [target],
        metrics,
      });
      expect(enqueued.isOk()).toBe(true);
      expect(enqueued._unsafeUnwrap()).toBeNull();

      // Ledger is transactional with the hook; the projection is not yet.
      expect(await refRows()).toHaveLength(1);
      expect(await fieldRow()).toBeUndefined();

      await projector.flushAllPendingActivity();
      expect(await fieldRow()).toMatchObject({
        status: 'queued',
        active_task_count: 1,
        processing_task_count: 0,
      });

      const claimed = await projector.onTasksClaimed({
        tasks: [{ taskId: 'task-async-1', baseId: BASE_ID }],
      });
      expect(claimed.isOk()).toBe(true);
      await projector.flushAllPendingActivity();
      expect(await fieldRow()).toMatchObject({
        status: 'running',
        active_task_count: 1,
        processing_task_count: 1,
      });

      const done = await projector.onTaskDone({
        taskId: 'task-async-1',
        baseId: BASE_ID,
        durationMs: 42,
      });
      expect(done.isOk()).toBe(true);
      expect(await refRows()).toHaveLength(0);
      await projector.flushAllPendingActivity();
      const settled = await fieldRow();
      expect(settled).toMatchObject({
        status: 'idle',
        active_task_count: 0,
        processing_task_count: 0,
        last_duration_ms: 42,
      });
      expect(settled?.last_completed_at).not.toBeNull();
    });

    it('coalesces many lifecycle events into one projection write', async () => {
      const target = { fieldId, tableId };
      const taskIds = ['task-c1', 'task-c2', 'task-c3'];
      await ensureOutboxTasks(taskIds);
      for (const taskId of taskIds) {
        expect(
          (
            await projector.onTaskEnqueued({ taskId, baseId: BASE_ID, targets: [target], metrics })
          ).isOk()
        ).toBe(true);
      }
      for (const taskId of taskIds) {
        expect((await projector.onTaskDone({ taskId, baseId: BASE_ID })).isOk()).toBe(true);
      }

      await projector.flushAllPendingActivity();
      const row = await fieldRow();
      expect(row).toMatchObject({
        status: 'idle',
        active_task_count: 0,
        processing_task_count: 0,
      });
      // Six lifecycle transitions collapse into one flush: generation moves once,
      // not once per transition.
      expect(Number(row?.generation)).toBeLessThanOrEqual(2);
    });

    it('settles a combined stage settlement through the flusher', async () => {
      const target = { fieldId, tableId };
      await ensureOutboxTasks(['task-s1', 'task-s2']);
      expect(
        (
          await projector.onTaskEnqueued({
            taskId: 'task-s1',
            baseId: BASE_ID,
            targets: [target],
            metrics,
          })
        ).isOk()
      ).toBe(true);
      expect(
        (await projector.onTasksClaimed({ tasks: [{ taskId: 'task-s1', baseId: BASE_ID }] })).isOk()
      ).toBe(true);

      const settled = await projector.projectStageSettlement({
        done: { taskId: 'task-s1', baseId: BASE_ID, durationMs: 7 },
        enqueued: { taskId: 'task-s2', baseId: BASE_ID, targets: [target], metrics },
        claimed: [{ taskId: 'task-s2', baseId: BASE_ID }],
      });
      expect(settled.isOk()).toBe(true);

      // Ledger already reflects the relay: task-s1 released, task-s2 processing.
      const refs = await refRows();
      expect(refs).toHaveLength(1);
      expect(refs[0]).toMatchObject({ task_id: 'task-s2', was_processing: true });

      await projector.flushAllPendingActivity();
      expect(await fieldRow()).toMatchObject({
        status: 'running',
        active_task_count: 1,
        processing_task_count: 1,
        last_duration_ms: 7,
      });
    });

    it('never projects phantom queued state from a rolled-back hook transaction', async () => {
      const target = { fieldId, tableId };
      await ensureOutboxTasks(['task-rb-1']);
      const failure = await db
        .transaction()
        .execute(async (trx) => {
          const enqueued = await projector.onTaskEnqueued({
            taskId: 'task-rb-1',
            baseId: BASE_ID,
            targets: [target],
            metrics,
            trx: trx as never,
          });
          expect(enqueued.isOk()).toBe(true);
          throw new Error('rollback');
        })
        .catch((error: Error) => error.message);
      expect(failure).toBe('rollback');
      expect(await refRows()).toHaveLength(0);

      await projector.flushAllPendingActivity();
      // With a bare trx handle (no after-commit hook) the metadata event cannot
      // be withheld, but counters re-derive from the rolled-back (absent) refs:
      // the field must not surface as queued/running.
      const row = await fieldRow();
      if (row) {
        expect(row).toMatchObject({
          status: 'idle',
          active_task_count: 0,
          processing_task_count: 0,
        });
      }
    });
  });

  describe('lock contention logging', () => {
    const createLogger = () => {
      const warn = vi.fn();
      const logger: ILogger = {
        child: () => logger,
        scope: () => logger,
        debug: vi.fn(),
        info: vi.fn(),
        warn,
        error: vi.fn(),
      };
      return { logger, warn };
    };

    const contentionProjector = (logger: ILogger) => {
      const instance = new ComputedActivityProjector(db, logger);
      // These cases exercise the legacy synchronous advisory-lock path that
      // remains available through the rollback switch.
      instance.configureAsyncProjection({ enabled: false });
      const mutable = instance as unknown as {
        lockContentionLogThresholdMs: number;
        lockContentionLogIntervalMs: number;
      };
      return { instance, mutable };
    };

    const contentionWarns = (warn: Mock) =>
      warn.mock.calls.filter(([message]) => message === 'computed:activity:lock_contended');

    it('does not log when the lock is acquired without contention', async () => {
      const { logger, warn } = createLogger();
      const { instance } = contentionProjector(logger);

      const enqueued = await instance.onTaskEnqueued({
        taskId: 'task-no-contention',
        baseId: BASE_ID,
        targets: [{ fieldId, tableId }],
        metrics,
      });

      expect(enqueued.isOk()).toBe(true);
      expect(contentionWarns(warn)).toHaveLength(0);
    });

    it('rate-limits contention warnings per table within the interval', async () => {
      const { logger, warn } = createLogger();
      const { instance, mutable } = contentionProjector(logger);
      // Force every acquire to count as contended so the rate limiter is what
      // decides whether a warn is emitted.
      mutable.lockContentionLogThresholdMs = 0;

      const enqueue = (
        taskId: string,
        target: { fieldId: typeof fieldId; tableId: typeof tableId }
      ) => instance.onTaskEnqueued({ taskId, baseId: BASE_ID, targets: [target], metrics });

      expect((await enqueue('task-contention-1', { fieldId, tableId })).isOk()).toBe(true);
      expect((await enqueue('task-contention-2', { fieldId, tableId })).isOk()).toBe(true);
      expect(
        (await enqueue('task-contention-3', { fieldId: fieldIdB, tableId: tableIdB })).isOk()
      ).toBe(true);

      const warns = contentionWarns(warn);
      expect(warns).toHaveLength(2);
      expect(warns[0]?.[1]).toMatchObject({
        operation: 'activity_on_task_enqueued',
        tableId: TABLE_ID,
      });
      expect(warns[1]?.[1]).toMatchObject({
        operation: 'activity_on_task_enqueued',
        tableId: TABLE_ID_B,
      });
    });

    it('logs contention again once the rate-limit interval has elapsed', async () => {
      const { logger, warn } = createLogger();
      const { instance, mutable } = contentionProjector(logger);
      mutable.lockContentionLogThresholdMs = 0;
      mutable.lockContentionLogIntervalMs = 0;

      const enqueue = (taskId: string) =>
        instance.onTaskEnqueued({
          taskId,
          baseId: BASE_ID,
          targets: [{ fieldId, tableId }],
          metrics,
        });

      expect((await enqueue('task-contention-1')).isOk()).toBe(true);
      expect((await enqueue('task-contention-2')).isOk()).toBe(true);

      expect(contentionWarns(warn)).toHaveLength(2);
    });
  });
});
