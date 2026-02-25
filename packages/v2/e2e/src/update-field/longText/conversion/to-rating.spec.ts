/**
 * E2E tests for converting LongText field to Rating.
 *
 * Conversion behavior (TextFieldConversionVisitor):
 * - Numeric strings are parsed, floored, and clamped to [0, max]: "3.7" -> 3
 * - Non-numeric strings become null: "abc" -> null
 * - Null values remain null
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: longText → rating conversion', () => {
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
      name: 'LongText to Rating Conversion',
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

  test('should convert numeric strings to rating values', async () => {
    // Setup: Create longText with numeric values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'longText', id: fieldId, name: 'Rating Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '3' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: '5' });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: '1' });

    // Action: Convert to rating with max: 5
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'rating', max: 5 },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('rating');

    // Assert: Values converted to ratings
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    const rec3 = records.find((r) => r.id === r3.id);
    expect(rec1?.fields[fieldId]).toBe(3);
    expect(rec2?.fields[fieldId]).toBe(5);
    expect(rec3?.fields[fieldId]).toBe(1);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should convert non-numeric strings to null', async () => {
    // Setup: Create longText with non-numeric values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'longText', id: fieldId, name: 'Invalid Rating' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'hello' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'Line 1\nLine 2' });

    // Action: Convert to rating with max: 5
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'rating', max: 5 },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('rating');

    // Assert: Non-numeric become null
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBeNull();
    expect(rec2?.fields[fieldId]).toBeNull();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should handle null values', async () => {
    // Setup: Create longText with null values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'longText', id: fieldId, name: 'Null Rating' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '4' });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' });

    // Action: Convert to rating with max: 5
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'rating', max: 5 },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('rating');

    // Assert: null remains null, valid value converted
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBe(4);
    expect(rec2?.fields[fieldId]).toBeNull();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });
});
