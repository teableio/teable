/**
 * E2E tests for converting Formula field to Date.
 * Aligned with v1: datetime formula preserves timestamp, number formula → null.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: formula → date conversion', () => {
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
      name: 'Formula to Date Conversion',
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

  test('should preserve datetime formula value when converting to date', async () => {
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
        name: 'Formula Date',
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
      field: { type: 'date' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === formulaFieldId);
    expect(updatedField?.type).toBe('date');

    const records = await ctx.listRecords(tableId);
    const recData = records.find((r) => r.id === rec.id);
    // timestamptz → timestamptz: value preserved
    expect(recData?.fields[formulaFieldId]).toBe('2024-01-15T10:30:00.000Z');

    await ctx.deleteField({ tableId, fieldId: formulaFieldId });
    await ctx.deleteField({ tableId, fieldId: dateFieldId });
    await ctx.deleteRecords(tableId, [rec.id]);
  });

  test('should produce null for number formula → date (incompatible)', async () => {
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
        name: 'Formula Num2Date',
        options: { expression: `{${numFieldId}}` },
      },
    });

    const rec = await ctx.createRecord(tableId, { [numFieldId]: 42 });
    await ctx.drainOutbox();

    await ctx.updateField({
      tableId,
      fieldId: formulaFieldId,
      field: { type: 'date' },
    });

    const records = await ctx.listRecords(tableId);
    const recData = records.find((r) => r.id === rec.id);
    // v1: number formatted as text can't parse as date → null
    expect(recData?.fields[formulaFieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId: formulaFieldId });
    await ctx.deleteField({ tableId, fieldId: numFieldId });
    await ctx.deleteRecords(tableId, [rec.id]);
  });

  test('should handle null values', async () => {
    const dateFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'date',
        id: dateFieldId,
        name: 'Null Date Source',
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
        name: 'Formula NullDate',
        options: {
          expression: `{${dateFieldId}}`,
          formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
        },
      },
    });

    const r1 = await ctx.createRecord(tableId, { [dateFieldId]: '2024-06-15T00:00:00.000Z' });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'empty' });
    await ctx.drainOutbox();

    await ctx.updateField({
      tableId,
      fieldId: formulaFieldId,
      field: { type: 'date' },
    });

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[formulaFieldId]).toBe('2024-06-15T00:00:00.000Z');
    expect(rec2?.fields[formulaFieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId: formulaFieldId });
    await ctx.deleteField({ tableId, fieldId: dateFieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });
});
