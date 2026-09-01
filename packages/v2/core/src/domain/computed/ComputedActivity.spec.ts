import { describe, expect, it } from 'vitest';

import { BaseId } from '../base/BaseId';
import { FieldId } from '../table/fields/FieldId';
import { TableId } from '../table/TableId';
import { ComputedActivity } from './ComputedActivity';

const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
const fieldA = {
  fieldId: FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap(),
  tableId,
};
const fieldB = {
  fieldId: FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap(),
  tableId,
};
const now = new Date('2026-07-16T00:00:00.000Z');

describe('ComputedActivity', () => {
  it('moves field to queued on attach and table to calculating', () => {
    const activity = ComputedActivity.empty();
    activity.attachTask({
      baseId,
      targets: [fieldA],
      estimatedComplexity: 10,
      estimatedDirtyRecords: 100,
      hasAllTargetRecords: false,
      now,
    });

    const field = activity.getField(fieldA.fieldId)!;
    expect(field.toDto().status).toBe('queued');
    expect(field.toDto().activeTaskCount).toBe(1);
    expect(field.toDto().estimatedComplexity).toBe(10);
    expect(field.toDto().estimatedDirtyRecords).toBe(100);

    const table = activity.getTable(tableId)!;
    expect(table.toDto().status).toBe('calculating');
    expect(table.toDto().queuedFieldCount).toBe(1);
    expect(table.toDto().calculatingFieldCount).toBe(0);
  });

  it('moves field to running on markProcessing', () => {
    const activity = ComputedActivity.empty();
    activity.attachTask({
      baseId,
      targets: [fieldA],
      estimatedComplexity: 5,
      estimatedDirtyRecords: 1,
      hasAllTargetRecords: false,
      now,
    });
    activity.markProcessing({ baseId, targets: [fieldA], now });

    const field = activity.getField(fieldA.fieldId)!;
    expect(field.toDto().status).toBe('running');
    expect(field.toDto().processingTaskCount).toBe(1);
    expect(field.toDto().startedAt).toBe(now.toISOString());

    const table = activity.getTable(tableId)!;
    expect(table.toDto().calculatingFieldCount).toBe(1);
    expect(table.toDto().queuedFieldCount).toBe(0);
  });

  it('keeps field active until all concurrent tasks release', () => {
    const activity = ComputedActivity.empty();
    activity.attachTask({
      baseId,
      targets: [fieldA],
      estimatedComplexity: 2,
      estimatedDirtyRecords: 1,
      hasAllTargetRecords: false,
      now,
    });
    activity.attachTask({
      baseId,
      targets: [fieldA],
      estimatedComplexity: 8,
      estimatedDirtyRecords: 50,
      hasAllTargetRecords: true,
      now,
    });

    expect(activity.getField(fieldA.fieldId)!.toDto().activeTaskCount).toBe(2);
    expect(activity.getField(fieldA.fieldId)!.toDto().estimatedComplexity).toBe(8);
    expect(activity.getField(fieldA.fieldId)!.toDto().hasAllTargetRecords).toBe(true);
    expect(activity.getField(fieldA.fieldId)!.toDto().extensions).toMatchObject({
      batchProgress: { total: 2, completed: 0 },
    });

    activity.markProcessing({ baseId, targets: [fieldA], now });
    activity.releaseTask({
      baseId,
      targets: [fieldA],
      wasProcessing: true,
      durationMs: 120,
      now,
    });

    expect(activity.getField(fieldA.fieldId)!.toDto().status).toBe('queued');
    expect(activity.getField(fieldA.fieldId)!.toDto().activeTaskCount).toBe(1);
    expect(activity.getField(fieldA.fieldId)!.toDto().extensions).toMatchObject({
      batchProgress: { total: 2, completed: 1 },
    });

    activity.releaseTask({
      baseId,
      targets: [fieldA],
      wasProcessing: false,
      durationMs: 50,
      now,
    });

    const field = activity.getField(fieldA.fieldId)!.toDto();
    expect(field.status).toBe('idle');
    expect(field.activeTaskCount).toBe(0);
    expect(field.lastDurationMs).toBe(50);
    expect(field.lastCompletedAt).toBe(now.toISOString());

    const table = activity.getTable(tableId)!.toDto();
    expect(table.status).toBe('idle');
    expect(table.recentCompletions.length).toBeGreaterThan(0);
    expect(table.recentCompletions[0]?.fieldId).toBe(fieldA.fieldId.toString());
    expect(table.generation).toBeGreaterThanOrEqual(4);
  });

  it('uses orchestration chunk indexes across sequential tasks', () => {
    const activity = ComputedActivity.empty();
    const attachChunk = (completed: number) =>
      activity.attachTask({
        baseId,
        targets: [fieldA],
        estimatedComplexity: 10,
        estimatedDirtyRecords: 200,
        hasAllTargetRecords: false,
        batchProgress: { groupId: 'paste-operation', total: 5, completed },
        now,
      });

    attachChunk(0);
    activity.releaseTask({
      baseId,
      targets: [fieldA],
      wasProcessing: false,
      now,
    });
    attachChunk(1);

    expect(activity.getField(fieldA.fieldId)!.toDto()).toMatchObject({
      status: 'queued',
      extensions: {
        batchProgress: { groupId: 'paste-operation', total: 5, completed: 1 },
      },
    });
  });

  it('tracks multiple fields and marks failed on terminal error', () => {
    const activity = ComputedActivity.empty();
    activity.attachTask({
      baseId,
      targets: [fieldA, fieldB],
      estimatedComplexity: 3,
      estimatedDirtyRecords: 2,
      hasAllTargetRecords: false,
      now,
    });
    activity.markProcessing({ baseId, targets: [fieldA, fieldB], now });
    activity.releaseTask({
      baseId,
      targets: [fieldA, fieldB],
      wasProcessing: true,
      error: { code: 'computed.failed', message: 'boom' },
      now,
    });

    expect(activity.getField(fieldA.fieldId)!.toDto().status).toBe('failed');
    expect(activity.getField(fieldA.fieldId)!.toDto().lastError?.message).toBe('boom');
    expect(activity.getTable(tableId)!.toDto().status).toBe('idle');
  });

  it('reconciles retry processing counts inside the aggregate', () => {
    const activity = ComputedActivity.empty();
    for (const estimatedComplexity of [2, 3]) {
      activity.attachTask({
        baseId,
        targets: [fieldA],
        estimatedComplexity,
        estimatedDirtyRecords: 1,
        hasAllTargetRecords: false,
        now,
      });
      activity.markProcessing({ baseId, targets: [fieldA], now });
    }

    activity.reconcileProcessing({
      targets: [{ ...fieldA, baseId, processingTaskCount: 1 }],
      lastError: { code: 'computed.retry', message: 'retry scheduled' },
      now,
    });

    const field = activity.getField(fieldA.fieldId)!.toDto();
    expect(field).toMatchObject({
      status: 'running',
      activeTaskCount: 2,
      processingTaskCount: 1,
      lastError: { code: 'computed.retry', message: 'retry scheduled' },
    });
    expect(activity.getTable(tableId)!.toDto()).toMatchObject({
      status: 'calculating',
      calculatingFieldCount: 1,
      queuedFieldCount: 0,
    });
  });

  it('keeps terminal failed status when task refs are already zero', () => {
    const activity = ComputedActivity.empty();
    activity.attachTask({
      baseId,
      targets: [fieldA],
      estimatedComplexity: 3,
      estimatedDirtyRecords: 1,
      hasAllTargetRecords: false,
      now,
    });
    activity.markProcessing({ baseId, targets: [fieldA], now });
    activity.releaseTask({
      baseId,
      targets: [fieldA],
      wasProcessing: true,
      error: { code: 'computed.failed', message: 'boom' },
      now,
    });
    expect(activity.getField(fieldA.fieldId)!.toDto().status).toBe('failed');

    activity.syncFromTaskRefs({
      targets: [{ ...fieldA, baseId, activeTaskCount: 0, processingTaskCount: 0 }],
      now,
    });

    expect(activity.getField(fieldA.fieldId)!.toDto()).toMatchObject({
      status: 'failed',
      activeTaskCount: 0,
      processingTaskCount: 0,
      lastError: { code: 'computed.failed', message: 'boom' },
    });
  });

  it('clears orphaned queued state when task refs drop to zero', () => {
    const activity = ComputedActivity.empty();
    activity.attachTask({
      baseId,
      targets: [fieldA],
      estimatedComplexity: 9,
      estimatedDirtyRecords: 5,
      hasAllTargetRecords: true,
      now,
    });
    expect(activity.getField(fieldA.fieldId)!.toDto().status).toBe('queued');

    activity.syncFromTaskRefs({
      targets: [{ ...fieldA, baseId, activeTaskCount: 0, processingTaskCount: 0 }],
      now,
    });

    expect(activity.getField(fieldA.fieldId)!.toDto()).toMatchObject({
      status: 'idle',
      activeTaskCount: 0,
      processingTaskCount: 0,
      estimatedComplexity: 0,
      estimatedDirtyRecords: 0,
      hasAllTargetRecords: false,
      queuedAt: null,
    });
    expect(activity.getField(fieldA.fieldId)!.toDto().extensions?.batchProgress).toBeUndefined();
    expect(activity.getTable(tableId)!.toDto().status).toBe('idle');
  });

  it('round-trips through snapshot', () => {
    const activity = ComputedActivity.empty();
    activity.attachTask({
      baseId,
      targets: [fieldA],
      estimatedComplexity: 1,
      estimatedDirtyRecords: 1,
      hasAllTargetRecords: false,
      now,
    });
    const restored = ComputedActivity.fromSnapshot(activity.snapshot())._unsafeUnwrap();
    expect(restored.getField(fieldA.fieldId)!.toDto().status).toBe('queued');
    expect(restored.getTable(tableId)!.toDto().queuedFieldCount).toBe(1);
  });

  it('bumps table generation when only recentCompletions change', () => {
    const activity = ComputedActivity.empty();
    activity.attachTask({
      baseId,
      targets: [fieldA, fieldB],
      estimatedComplexity: 1,
      estimatedDirtyRecords: 1,
      hasAllTargetRecords: false,
      now,
    });
    activity.markProcessing({ baseId, targets: [fieldA, fieldB], now });
    const genAfterStart = activity.getTable(tableId)!.toDto().generation;

    // Completing one of two running fields keeps table calculating; generation must still advance
    // so ShareDB can publish recentCompletions (T6276).
    activity.releaseTask({
      baseId,
      targets: [fieldA],
      wasProcessing: true,
      durationMs: 25,
      now,
    });

    const table = activity.getTable(tableId)!.toDto();
    expect(table.status).toBe('calculating');
    expect(table.recentCompletions[0]?.fieldId).toBe(fieldA.fieldId.toString());
    expect(table.generation).toBe(genAfterStart + 1);
  });

  it('syncFromTaskRefs is authoritative over drifted attach counters', () => {
    const activity = ComputedActivity.empty();
    // Simulate a drifted projection that thinks a task is still active.
    activity.attachTask({
      baseId,
      targets: [fieldA],
      estimatedComplexity: 1,
      estimatedDirtyRecords: 1,
      hasAllTargetRecords: false,
      now,
    });
    expect(activity.getField(fieldA.fieldId)!.toDto().activeTaskCount).toBe(1);

    // Real refs are empty; sync must clear without depending on another attach/release pair.
    activity.syncFromTaskRefs({
      targets: [
        {
          ...fieldA,
          baseId,
          activeTaskCount: 0,
          processingTaskCount: 0,
        },
      ],
      now,
    });
    expect(activity.getField(fieldA.fieldId)!.toDto().activeTaskCount).toBe(0);
    expect(activity.getField(fieldA.fieldId)!.toDto().status).toBe('idle');
  });

  it('bumps field generation when metadata changes but ref counts stay equal', () => {
    const activity = ComputedActivity.empty();
    activity.attachTask({
      baseId,
      targets: [fieldA],
      estimatedComplexity: 1,
      estimatedDirtyRecords: 1,
      hasAllTargetRecords: false,
      now,
    });
    const restored = ComputedActivity.fromSnapshot(activity.snapshot())._unsafeUnwrap();
    const generation = restored.getField(fieldA.fieldId)!.toDto().generation;

    restored.noteEnqueueMetrics({
      baseId,
      targets: [fieldA],
      estimatedComplexity: 2,
      estimatedDirtyRecords: 3,
      hasAllTargetRecords: true,
      now: new Date('2026-07-16T00:01:00.000Z'),
    });
    restored.syncFromTaskRefs({
      targets: [{ ...fieldA, baseId, activeTaskCount: 1, processingTaskCount: 0 }],
      now: new Date('2026-07-16T00:01:00.000Z'),
    });

    expect(restored.getField(fieldA.fieldId)!.toDto()).toMatchObject({
      generation: generation + 1,
      estimatedComplexity: 2,
      estimatedDirtyRecords: 3,
      hasAllTargetRecords: true,
    });
  });

  it('reports only documents whose generation changed', () => {
    const activity = ComputedActivity.empty();
    for (let index = 0; index < 2; index += 1) {
      activity.attachTask({
        baseId,
        targets: [fieldA],
        estimatedComplexity: 1,
        estimatedDirtyRecords: 1,
        hasAllTargetRecords: false,
        now,
      });
    }
    activity.markProcessing({ baseId, targets: [fieldA], now });
    const restored = ComputedActivity.fromSnapshot(activity.snapshot())._unsafeUnwrap();

    restored.syncFromTaskRefs({
      targets: [{ ...fieldA, baseId, activeTaskCount: 2, processingTaskCount: 2 }],
      now: new Date('2026-07-16T00:01:00.000Z'),
    });

    expect(restored.changedSnapshot().fields).toHaveLength(1);
    expect(restored.changedSnapshot().tables).toHaveLength(0);
  });

  it('keeps computed cell-limit lastError after a successful release', () => {
    const activity = ComputedActivity.empty();
    activity.attachTask({
      baseId,
      targets: [fieldA],
      estimatedComplexity: 1,
      estimatedDirtyRecords: 1,
      hasAllTargetRecords: false,
      now,
    });
    activity.markProcessing({ baseId, targets: [fieldA], now });
    activity.notePersistentFieldErrors({
      errors: [
        {
          fieldId: fieldA.fieldId.toString(),
          error: {
            code: 'validation.limit.computed_cell_value_max_bytes',
            message:
              'Computed cell value is too large (312000 / 262144 bytes). Shorten the source data or change the formula.',
            context: { attempted: 312000, max: 262144 },
          },
        },
      ],
      now,
    });
    activity.releaseTask({
      baseId,
      targets: [fieldA],
      wasProcessing: true,
      durationMs: 40,
      now,
    });

    const field = activity.getField(fieldA.fieldId)!.toDto();
    expect(field.status).toBe('failed');
    expect(field.lastError?.code).toBe('validation.limit.computed_cell_value_max_bytes');
    expect(field.lastError?.context).toEqual({ attempted: 312000, max: 262144 });
  });

  it('clears computed cell-limit lastError when a new task is attached', () => {
    const activity = ComputedActivity.empty();
    activity.attachTask({
      baseId,
      targets: [fieldA],
      estimatedComplexity: 1,
      estimatedDirtyRecords: 1,
      hasAllTargetRecords: false,
      now,
    });
    activity.notePersistentFieldErrors({
      errors: [
        {
          fieldId: fieldA.fieldId.toString(),
          error: {
            code: 'validation.limit.computed_cell_value_max_bytes',
            message: 'too large',
          },
        },
      ],
      now,
    });
    activity.releaseTask({
      baseId,
      targets: [fieldA],
      wasProcessing: false,
      now,
    });
    expect(activity.getField(fieldA.fieldId)!.toDto().status).toBe('failed');

    activity.attachTask({
      baseId,
      targets: [fieldA],
      estimatedComplexity: 1,
      estimatedDirtyRecords: 1,
      hasAllTargetRecords: false,
      now,
    });
    expect(activity.getField(fieldA.fieldId)!.toDto().lastError).toBeNull();
    expect(activity.getField(fieldA.fieldId)!.toDto().status).toBe('queued');
  });
});
