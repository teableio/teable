/**
 * E2E tests for converting SingleLineText field to MultipleSelect field.
 *
 * Conversion behavior (aligned with V1):
 * - Text values split by comma/newline and wrapped in arrays: "A, B" → ["A", "B"]
 * - Single values wrapped in arrays: "A" → ["A"]
 * - Options auto-generated from distinct split values
 * - Null values remain null
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: singleLineText → multipleSelect conversion', () => {
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
      name: 'SingleLineText to MultipleSelect Conversion',
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

  test('should wrap single values in array with option generation', async () => {
    // Setup: Create singleLineText with values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Fruit Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Apple' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'Banana' });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 'Apple' });

    // Action: Convert to multipleSelect
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'multipleSelect' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('multipleSelect');

    // Assert: Values wrapped in arrays
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    const rec3 = records.find((r) => r.id === r3.id);
    expect(rec1?.fields[fieldId]).toEqual(['Apple']);
    expect(rec2?.fields[fieldId]).toEqual(['Banana']);
    expect(rec3?.fields[fieldId]).toEqual(['Apple']);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should split comma-separated values (V1 parity)', async () => {
    // Setup: Create singleLineText with comma-separated value
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Comma Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Apple, Banana' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'Cherry' });

    // Action: Convert to multipleSelect
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'multipleSelect' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('multipleSelect');

    // Assert: Comma-separated value split into array
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toEqual(['Apple', 'Banana']);
    expect(rec2?.fields[fieldId]).toEqual(['Cherry']);

    // Assert: Options generated from split values
    const options = updatedField?.options as { choices: Array<{ name: string }> };
    const choiceNames = options.choices.map((c) => c.name);
    expect(choiceNames).toContain('Apple');
    expect(choiceNames).toContain('Banana');
    expect(choiceNames).toContain('Cherry');

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
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

    // Action: Convert to multipleSelect
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'multipleSelect' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('multipleSelect');

    // Assert: null remains null, others wrapped in arrays
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    const rec3 = records.find((r) => r.id === r3.id);
    expect(rec1?.fields[fieldId]).toEqual(['Option A']);
    expect(rec2?.fields[fieldId]).toBeNull();
    expect(rec3?.fields[fieldId]).toEqual(['Option B']);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should handle special characters', async () => {
    // Setup: Create singleLineText with special characters
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Special Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'A & B' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: "Test's Value" });

    // Action: Convert to multipleSelect
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'multipleSelect' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('multipleSelect');

    // Assert: Special characters preserved
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toEqual(['A & B']);
    expect(rec2?.fields[fieldId]).toEqual(["Test's Value"]);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });
});
