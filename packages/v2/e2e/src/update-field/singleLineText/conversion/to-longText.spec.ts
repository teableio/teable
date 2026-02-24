/**
 * E2E tests for converting SingleLineText field to LongText.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: singleLineText → longText conversion', () => {
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
      name: 'SingleLineText to LongText Conversion',
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

  test('should preserve text values', async () => {
    // Setup: Create singleLineText field with values: "Hello", "World"
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Text Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Hello' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'World' });

    // Action: Convert to longText
    const updatedTable = await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: { type: 'longText' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('longText');

    // Assert: Values preserved
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBe('Hello');
    expect(rec2?.fields[fieldId]).toBe('World');

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should handle null values', async () => {
    // Setup: Create singleLineText field with null
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Null Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'has value' });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No field value' });

    // Action: Convert to longText
    await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: { type: 'longText' },
    });

    // Assert: null remains null
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBe('has value');
    expect(rec2?.fields[fieldId]).toBeNull();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should handle empty strings', async () => {
    // Setup: Create singleLineText field with value: ""
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Empty Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'non-empty' });

    // Action: Convert to longText
    await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: { type: 'longText' },
    });

    // Assert: Empty string preserved (or stored as null)
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId] === '' || rec1?.fields[fieldId] === null).toBe(true);
    expect(rec2?.fields[fieldId]).toBe('non-empty');

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });
});
