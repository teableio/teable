import { FieldId, NoopLogger, TableId } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely, type KyselyPlugin } from 'kysely';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPGliteDb } from '../../../schema/visitors/__tests__/helpers/createPGliteDb';
import { ComputedActivityProjector } from './ComputedActivityProjector';
import { PostgresComputedActivityReader } from './PostgresComputedActivityReader';

const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;
const FIELD_ID = `fld${'c'.repeat(16)}`;
const FIELD_ID_B = `fld${'d'.repeat(16)}`;
const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
const fieldId = FieldId.create(FIELD_ID)._unsafeUnwrap();

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
      .execute();

    projector = new ComputedActivityProjector(db, new NoopLogger());
    reader = new PostgresComputedActivityReader(db, projector);
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
  it('reads and heals activity through a schema-scoped database', async () => {
    const dataSchema = 'teable_byodb_activity';
    const activityTables = [
      'computed_field_activity',
      'computed_table_activity',
      'computed_task_field_ref',
      'computed_update_outbox',
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
    const dataReader = new PostgresComputedActivityReader(dataDb, dataProjector);
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
});
