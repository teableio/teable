/**
 * E2E tests for converting Formula field to Number.
 * Aligned with v1: number formula preserves value, datetime formula → null.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: formula → number conversion', () => {
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
      name: 'Formula to Number Conversion',
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

  test('should preserve number formula value when converting to number', async () => {
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
        name: 'Formula Num',
        options: { expression: `{${numFieldId}}` },
      },
    });

    const r1 = await ctx.createRecord(tableId, { [numFieldId]: 42 });
    const r2 = await ctx.createRecord(tableId, { [numFieldId]: 3.14 });
    await ctx.drainOutbox();

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId: formulaFieldId,
      field: { type: 'number' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === formulaFieldId);
    expect(updatedField?.type).toBe('number');

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[formulaFieldId]).toBe(42);
    expect(rec2?.fields[formulaFieldId]).toBe(3.14);

    await ctx.deleteField({ tableId, fieldId: formulaFieldId });
    await ctx.deleteField({ tableId, fieldId: numFieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should produce null for datetime formula → number (incompatible)', async () => {
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
        name: 'Formula Date2Num',
        options: {
          expression: `{${dateFieldId}}`,
          formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
        },
      },
    });

    const rec = await ctx.createRecord(tableId, { [dateFieldId]: '2024-01-15T10:30:00.000Z' });
    await ctx.drainOutbox();

    await ctx.updateField({
      tableId,
      fieldId: formulaFieldId,
      field: { type: 'number' },
    });

    const records = await ctx.listRecords(tableId);
    const recData = records.find((r) => r.id === rec.id);
    // v1: formatted date string is not a valid number → null
    expect(recData?.fields[formulaFieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId: formulaFieldId });
    await ctx.deleteField({ tableId, fieldId: dateFieldId });
    await ctx.deleteRecords(tableId, [rec.id]);
  });

  test('should handle null values', async () => {
    const numFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', id: numFieldId, name: 'Null Num Source' },
    });

    const formulaFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        id: formulaFieldId,
        name: 'Formula NullNum',
        options: { expression: `{${numFieldId}}` },
      },
    });

    const r1 = await ctx.createRecord(tableId, { [numFieldId]: 7 });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'empty' });
    await ctx.drainOutbox();

    await ctx.updateField({
      tableId,
      fieldId: formulaFieldId,
      field: { type: 'number' },
    });

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[formulaFieldId]).toBe(7);
    expect(rec2?.fields[formulaFieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId: formulaFieldId });
    await ctx.deleteField({ tableId, fieldId: numFieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });
});
