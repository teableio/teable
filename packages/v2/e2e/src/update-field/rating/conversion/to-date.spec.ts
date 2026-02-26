/**
 * E2E tests for converting Rating field to Date.
 *
 * Conversion behavior (NumberFieldConversionVisitor.visitDateField):
 * - Rating values are interpreted as Unix timestamps in milliseconds via to_timestamp(col / 1000).
 * - Small rating values (1-5) produce timestamps very close to epoch (1970-01-01T00:00:00Z).
 * - null → null
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: rating → date conversion', () => {
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
      name: 'Rating to Date Conversion',
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
        /* Ignore cleanup errors */
      }
    }
  });

  test('should convert rating values to timestamps near epoch', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'rating',
        id: fieldId,
        name: 'Rating Field',
        options: { max: 5, icon: 'star', color: 'yellowBright' },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 3 });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 5 });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'date' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('date');

    // Rating values (3, 5) are interpreted as millisecond timestamps.
    // to_timestamp(3/1000) = to_timestamp(0.003) -> 1970-01-01T00:00:00.003Z
    // to_timestamp(5/1000) = to_timestamp(0.005) -> 1970-01-01T00:00:00.005Z
    // These are valid timestamps near epoch, not null.
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    // The result should be a valid date string near epoch
    expect(rec1?.fields[fieldId]).toBeTruthy();
    expect(rec2?.fields[fieldId]).toBeTruthy();
    // Verify they are near epoch (1970-01-01)
    const date1 = new Date(rec1?.fields[fieldId] as string);
    const date2 = new Date(rec2?.fields[fieldId] as string);
    expect(date1.getUTCFullYear()).toBe(1970);
    expect(date2.getUTCFullYear()).toBe(1970);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should handle null values', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'rating',
        id: fieldId,
        name: 'Null Rating Field',
        options: { max: 5, icon: 'star', color: 'yellowBright' },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'date' },
    });

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    expect(rec1?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });
});
