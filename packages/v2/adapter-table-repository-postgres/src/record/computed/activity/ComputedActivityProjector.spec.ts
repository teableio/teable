import { FieldId, NoopLogger, TableId } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPGliteDb } from '../../../schema/visitors/__tests__/helpers/createPGliteDb';
import { ComputedActivityProjector } from './ComputedActivityProjector';
import { PostgresComputedActivityReader } from './PostgresComputedActivityReader';

const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;
const FIELD_ID = `fld${'c'.repeat(16)}`;
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

    projector = new ComputedActivityProjector(db, new NoopLogger());
    reader = new PostgresComputedActivityReader(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('keeps a field running until every claimed task finishes', async () => {
    const target = { fieldId, tableId };

    for (const taskId of ['task-1', 'task-2']) {
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
    const enqueueChunk = (taskId: string, completed: number) =>
      projector.onTaskEnqueued({
        taskId,
        baseId: BASE_ID,
        targets: [target],
        metrics: {
          ...metrics,
          batchProgress: { groupId: 'paste-operation', total: 5, completed },
        },
      });

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
      ['task-concurrent-1', 'task-concurrent-2'].map((taskId) =>
        projector.onTaskEnqueued({
          taskId,
          baseId: BASE_ID,
          targets: [target],
          metrics,
        })
      )
    );
    expect(results.every((result) => result.isOk())).toBe(true);

    const snapshot = await reader.getByTableId(undefined, TABLE_ID);
    expect(snapshot.isOk()).toBe(true);
    expect(snapshot._unsafeUnwrap().fields[0]).toMatchObject({
      status: 'queued',
      activeTaskCount: 2,
    });
  });
});
