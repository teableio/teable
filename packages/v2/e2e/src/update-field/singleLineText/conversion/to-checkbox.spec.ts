/**
 * E2E tests for converting SingleLineText field to Checkbox field.
 *
 * Conversion behavior (matches V1):
 * - Any non-empty, non-null string becomes true
 * - Empty strings become null
 * - Null values remain null
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: singleLineText → checkbox conversion', () => {
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
      name: 'SingleLineText to Checkbox Conversion',
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

  test('should convert truthy strings to true', async () => {
    // Setup: Create singleLineText with truthy values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Truthy Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'true' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: '1' });

    // Action: Convert to checkbox
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'checkbox' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('checkbox');

    // Assert: Truthy strings become true
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBe(true);
    expect(rec2?.fields[fieldId]).toBe(true);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should convert falsy strings to true (V1 behavior: any non-empty text is truthy)', async () => {
    // Setup: Create singleLineText with falsy values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Falsy Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'false' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: '0' });

    // Action: Convert to checkbox
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'checkbox' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('checkbox');

    // Assert: In V1 behavior, any non-empty string is truthy
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBe(true);
    expect(rec2?.fields[fieldId]).toBe(true);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should handle case-insensitive matching (V1: all non-empty strings are truthy)', async () => {
    // Setup: Create singleLineText with mixed case values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Case Test' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'TRUE' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'True' });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 'FALSE' });

    // Action: Convert to checkbox
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'checkbox' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('checkbox');

    // Assert: All non-empty strings become true (V1 behavior)
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    const rec3 = records.find((r) => r.id === r3.id);
    expect(rec1?.fields[fieldId]).toBe(true);
    expect(rec2?.fields[fieldId]).toBe(true);
    expect(rec3?.fields[fieldId]).toBe(true);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should convert all non-empty strings to true (V1 behavior)', async () => {
    // Setup: Create singleLineText with non-boolean values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Non-Boolean' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'maybe' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'abc' });

    // Action: Convert to checkbox
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'checkbox' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('checkbox');

    // Assert: V1 behavior - any non-empty string is truthy
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBe(true);
    expect(rec2?.fields[fieldId]).toBe(true);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should handle null values', async () => {
    // Setup: Create singleLineText with null value
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Null Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'true' });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' }); // null for fieldId

    // Action: Convert to checkbox
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'checkbox' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('checkbox');

    // Assert: null remains null
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBe(true);
    expect(rec2?.fields[fieldId]).toBeNull();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });
});
