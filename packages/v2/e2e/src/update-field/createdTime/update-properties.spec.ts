/**
 * F15 / D16 — createdTime property updates.
 *
 * Requirement IDs: F15 (created time is system generated and not writable),
 * D16 (a system field cannot take a user default), S11 (date/time formatting).
 *
 * `createdTime` needs its own directory rather than living in a
 * "computed" bucket: §2 of the requirement document keys every capability row by
 * field type, and the update surface has to be navigable the same way.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { DateFormattingPreset, TimeFormatting } from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

describe('[D01][S01] F15: createdTime property updates', () => {
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
      name: 'createdTime Update Test',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  test('updates the name and the date formatting together', async () => {
    const fieldId = nextFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'createdTime', id: fieldId, name: 'Created At' },
    });

    const updated = await ctx.updateField({
      tableId,
      fieldId,
      field: {
        name: 'Created Time Updated',
        options: {
          formatting: {
            date: DateFormattingPreset.US,
            time: TimeFormatting.Hour24,
            timeZone: 'utc',
          },
        },
      },
    });

    const field = updated.fields.find((candidate) => candidate.id === fieldId);
    expect(field?.type).toBe('createdTime');
    expect(field?.name).toBe('Created Time Updated');
    expect(field?.options).toMatchObject({
      formatting: { date: DateFormattingPreset.US, time: TimeFormatting.Hour24 },
    });

    await ctx.deleteField({ tableId, fieldId });
  });

  test('keeps the stored instant when only the display changes', async () => {
    const fieldId = nextFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'createdTime', id: fieldId, name: 'Created Iso' },
    });
    const record = await ctx.createRecord(tableId, {});
    const rowsBefore = await ctx.listRecords(tableId, { limit: 1000 });
    const before = rowsBefore.find((row) => row.id === record.id)?.fields[fieldId];

    await ctx.updateField({
      tableId,
      fieldId,
      field: {
        options: {
          formatting: {
            date: DateFormattingPreset.M,
            time: TimeFormatting.None,
            timeZone: 'Asia/Singapore',
          },
        },
      },
    });

    const rowsAfter = await ctx.listRecords(tableId, { limit: 1000 });
    expect(rowsAfter.find((row) => row.id === record.id)?.fields[fieldId]).toBe(before);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [record.id]);
  });

  test('rejects a payload that tries to give the field a default value', async () => {
    const fieldId = nextFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'createdTime', id: fieldId, name: 'Created No Default' },
    });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { defaultValue: '2024-01-01T00:00:00.000Z' } as never },
    });

    const reloaded = await ctx.getTableById(tableId);
    expect(
      (reloaded.fields.find((f) => f.id === fieldId)?.options as { defaultValue?: unknown })
        ?.defaultValue
    ).toBeUndefined();

    await ctx.deleteField({ tableId, fieldId });
  });
});
