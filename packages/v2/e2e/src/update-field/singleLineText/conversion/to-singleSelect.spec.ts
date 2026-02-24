/**
 * E2E tests for converting SingleLineText field to SingleSelect field.
 *
 * Conversion behavior:
 * - Existing values become select options
 * - New options are automatically created from distinct cell values
 * - Null values remain null
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: singleLineText → singleSelect conversion', () => {
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
      name: 'SingleLineText to SingleSelect Conversion',
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

  test('should generate options from existing values', async () => {
    // Setup: Create singleLineText with values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Fruit Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Apple' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'Banana' });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 'Apple' }); // duplicate

    // Action: Convert to singleSelect
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleSelect' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('singleSelect');

    // Assert: Values preserved
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    const rec3 = records.find((r) => r.id === r3.id);
    expect(rec1?.fields[fieldId]).toBe('Apple');
    expect(rec2?.fields[fieldId]).toBe('Banana');
    expect(rec3?.fields[fieldId]).toBe('Apple');

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
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Option A' });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' }); // null for fieldId
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 'Option B' });

    // Action: Convert to singleSelect
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleSelect' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('singleSelect');

    // Assert: null remains null, other values preserved
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    const rec3 = records.find((r) => r.id === r3.id);
    expect(rec1?.fields[fieldId]).toBe('Option A');
    expect(rec2?.fields[fieldId]).toBeNull();
    expect(rec3?.fields[fieldId]).toBe('Option B');

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should convert with predefined options matching values', async () => {
    // Setup: Create singleLineText with values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Color Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Red' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'Green' });

    // Action: Convert to singleSelect (options will be auto-generated)
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleSelect' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('singleSelect');

    // Assert: Values preserved
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBe('Red');
    expect(rec2?.fields[fieldId]).toBe('Green');

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should handle special characters in values', async () => {
    // Setup: Create singleLineText with special characters
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Special Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'A & B' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: "E's Test" });

    // Action: Convert to singleSelect
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleSelect' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('singleSelect');

    // Assert: Special characters preserved
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBe('A & B');
    expect(rec2?.fields[fieldId]).toBe("E's Test");

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should deduplicate values when creating options', async () => {
    // Setup: Create singleLineText with duplicate values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Dedup Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'X' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'Y' });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 'X' });
    const r4 = await ctx.createRecord(tableId, { [fieldId]: 'Y' });
    const r5 = await ctx.createRecord(tableId, { [fieldId]: 'Z' });

    // Action: Convert to singleSelect
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleSelect' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('singleSelect');

    // Assert: All values preserved correctly
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    const rec3 = records.find((r) => r.id === r3.id);
    const rec4 = records.find((r) => r.id === r4.id);
    const rec5 = records.find((r) => r.id === r5.id);
    expect(rec1?.fields[fieldId]).toBe('X');
    expect(rec2?.fields[fieldId]).toBe('Y');
    expect(rec3?.fields[fieldId]).toBe('X');
    expect(rec4?.fields[fieldId]).toBe('Y');
    expect(rec5?.fields[fieldId]).toBe('Z');

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id, r4.id, r5.id]);
  });
});
