/**
 * E2E tests for converting Formula field to SingleSelect.
 * Aligned with v1: value formatted as text becomes the select option.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: formula → singleSelect conversion', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Formula to SingleSelect Conversion',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;
    const primaryField = table.fields.find((f) => f.isPrimary);
    if (!primaryField) throw new Error('No primary field');
    primaryFieldId = primaryField.id;
  });

  afterAll(async () => {
    if (tableId) {
      try {
        await ctx.deleteTable(tableId);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  test('should convert number formula to singleSelect with auto-generated options', async () => {
    const numFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', id: numFieldId, name: 'Num Source' },
    });

    const formulaFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        id: formulaFieldId,
        name: 'Formula Sel',
        options: { expression: `{${numFieldId}}` },
      },
    });

    const r1 = await ctx.createRecord(tableId, { [numFieldId]: 42 });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'empty' });
    await ctx.drainOutbox();

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId: formulaFieldId,
      field: { type: 'singleSelect' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === formulaFieldId);
    expect(updatedField?.type).toBe('singleSelect');

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[formulaFieldId]).toBe('42');
    expect(rec2?.fields[formulaFieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId: formulaFieldId });
    await ctx.deleteField({ tableId, fieldId: numFieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should convert datetime formula to singleSelect with formatted value', async () => {
    const dateFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'date',
        id: dateFieldId,
        name: 'Date Source',
        options: {
          formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
        },
      },
    });

    const formulaFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        id: formulaFieldId,
        name: 'Formula DtSel',
        options: {
          expression: `{${dateFieldId}}`,
          formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
        },
      },
    });

    const rec = await ctx.createRecord(tableId, { [dateFieldId]: '2024-01-15T10:30:00.000Z' });
    await ctx.drainOutbox();

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId: formulaFieldId,
      field: { type: 'singleSelect' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === formulaFieldId);
    expect(updatedField?.type).toBe('singleSelect');

    const records = await ctx.listRecords(tableId);
    const recData = records.find((r) => r.id === rec.id);
    // DateTime formula formatted with to_char becomes the select option
    expect(recData?.fields[formulaFieldId]).toBe('2024-01-15 10:30');

    await ctx.deleteField({ tableId, fieldId: formulaFieldId });
    await ctx.deleteField({ tableId, fieldId: dateFieldId });
    await ctx.deleteRecords(tableId, [rec.id]);
  });
});
