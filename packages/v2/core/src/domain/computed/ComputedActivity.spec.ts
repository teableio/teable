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
    expect(table.generation).toBe(5);
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
});
