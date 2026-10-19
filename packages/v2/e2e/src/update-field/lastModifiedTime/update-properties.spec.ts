/**
 * F16 / S11 / B02 — lastModifiedTime property updates and tracking scope.
 *
 * Requirement IDs: F16 (system generated, `trackedFieldIds` scope), S11 (date/time formatting), B02 (tracked fields).
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { DateFormattingPreset, TimeFormatting } from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  fieldByName,
  fieldOptions,
  getSharedTestContext,
  readValue,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

describe('[D01][S01] F16: lastModifiedTime property updates', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let fieldSeq = 0;

  const nextFieldId = () => {
    fieldSeq += 1;
    return `fld${fieldSeq.toString(36).padStart(16, '0')}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'lastModifiedTime Update Test',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  test('updates the name, formatting and tracking list together', async () => {
    const fieldId = nextFieldId();
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'lastModifiedTime', id: fieldId, name: 'Updated At' },
    });
    const trackedId = fieldByName(created, 'Name').id;

    const updated = await ctx.updateField({
      tableId,
      fieldId,
      field: {
        name: 'Last Modified Updated',
        options: {
          formatting: {
            date: DateFormattingPreset.Asian,
            time: TimeFormatting.None,
            timeZone: 'utc',
          },
          trackedFieldIds: [trackedId],
        },
      },
    });

    const field = updated.fields.find((candidate) => candidate.id === fieldId);
    expect(field?.type).toBe('lastModifiedTime');
    expect(field?.name).toBe('Last Modified Updated');
    expect(fieldOptions(field)).toMatchObject({
      formatting: { date: DateFormattingPreset.Asian, time: TimeFormatting.None },
      trackedFieldIds: [trackedId],
    });

    await ctx.deleteField({ tableId, fieldId });
  });

  test('B02 narrowing the tracking list keeps existing instants', async () => {
    const fieldId = nextFieldId();
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'lastModifiedTime', id: fieldId, name: 'Track All First' },
    });
    const trackedId = fieldByName(created, 'Name').id;
    const record = await ctx.createRecord(tableId, {});

    const before = await readValue(ctx, tableId, record.id, fieldId);
    expect(before).toBeTruthy();

    await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { trackedFieldIds: [trackedId] } },
    });

    // The stored column is rebuilt in place, so the instant already written for
    // existing rows survives the tracking change.
    await expect(readValue(ctx, tableId, record.id, fieldId)).resolves.toBe(before);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [record.id]);
  });

  test('B02 widening back to track-all resumes stamping untouched fields', async () => {
    const fieldId = nextFieldId();
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'lastModifiedTime', id: fieldId, name: 'Track Later' },
    });
    const trackedId = fieldByName(created, 'Name').id;
    await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { trackedFieldIds: [trackedId] } },
    });

    const record = await ctx.createRecord(tableId, {});
    const withTracking = await readValue(ctx, tableId, record.id, fieldId);
    // Created with its only tracked field empty: the restricted list has no
    // change to record, so the widening test starts from an empty stamp.
    expect(withTracking ?? null).toBeNull();

    await ctx.updateField({ tableId, fieldId, field: { options: { trackedFieldIds: [] } } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const editFloor = Date.now();
    await ctx.updateRecord(tableId, record.id, { [trackedId]: 'moved' });

    const widened = await readValue(ctx, tableId, record.id, fieldId);
    // The edit's own instant, not a creation time carried over from before.
    expect(Date.parse(widened as string)).toBeGreaterThanOrEqual(editFloor);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [record.id]);
  });
});
