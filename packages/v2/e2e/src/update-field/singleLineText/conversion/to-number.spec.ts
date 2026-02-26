/**
 * E2E tests for converting SingleLineText field to Number field.
 *
 * Conversion behavior:
 * - Parse numeric strings to numbers
 * - Invalid strings become null
 * - Null values remain null
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: singleLineText → number conversion', () => {
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
      name: 'SingleLineText to Number Conversion',
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

  // ============ Basic conversion ============

  test('should convert valid numeric strings to numbers', async () => {
    // Setup: Create singleLineText with numeric values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Numeric Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '123' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: '45.67' });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: '-89' });

    // Action: Convert to number
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'number' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('number');

    // Assert: Values converted to numbers
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    const rec3 = records.find((r) => r.id === r3.id);
    expect(rec1?.fields[fieldId]).toBe(123);
    expect(rec2?.fields[fieldId]).toBe(45.67);
    expect(rec3?.fields[fieldId]).toBe(-89);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should convert invalid strings to null', async () => {
    // Setup: Create singleLineText with invalid numeric values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Invalid Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'abc' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'hello123' });

    // Action: Convert to number
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'number' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('number');

    // Assert: Invalid strings become null
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBeNull();
    expect(rec2?.fields[fieldId]).toBeNull();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should handle mixed valid/invalid values', async () => {
    // Setup: Create singleLineText with mixed values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Mixed Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '100' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'abc' });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: '200.5' });

    // Action: Convert to number
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'number' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('number');

    // Assert: Valid converted, invalid becomes null
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    const rec3 = records.find((r) => r.id === r3.id);
    expect(rec1?.fields[fieldId]).toBe(100);
    expect(rec2?.fields[fieldId]).toBeNull();
    expect(rec3?.fields[fieldId]).toBe(200.5);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should handle null values', async () => {
    // Setup: Create singleLineText with null values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Null Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '42' });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' }); // null for fieldId

    // Action: Convert to number
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'number' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('number');

    // Assert: null remains null
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBe(42);
    expect(rec2?.fields[fieldId]).toBeNull();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should handle decimal numbers', async () => {
    // Setup: Create singleLineText with decimal values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Decimal Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '3.14159' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: '0.001' });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: '-99.99' });

    // Action: Convert to number
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'number' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('number');

    // Assert: Decimal values preserved
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    const rec3 = records.find((r) => r.id === r3.id);
    expect(rec1?.fields[fieldId]).toBeCloseTo(3.14159, 5);
    expect(rec2?.fields[fieldId]).toBeCloseTo(0.001, 5);
    expect(rec3?.fields[fieldId]).toBeCloseTo(-99.99, 2);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });
});
