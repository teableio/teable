/**
 * E2E tests for converting MultipleSelect field to Checkbox.
 *
 * Conversion behavior:
 * - Non-empty array -> true
 * - Empty array -> null
 * - Null -> null
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: multipleSelect → checkbox conversion', () => {
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
      name: 'MultipleSelect to Checkbox Conversion',
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

  test('should convert non-empty arrays to true', async () => {
    // Setup: Create multipleSelect field with non-empty arrays
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Multi Checkbox Field',
        options: {
          choices: [
            { id: 'cho1', name: 'Red', color: 'redBright' },
            { id: 'cho2', name: 'Green', color: 'greenBright' },
          ],
        },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: ['Red', 'Green'] });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: ['Red'] });

    // Action: Convert to checkbox
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'checkbox' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('checkbox');

    // Assert: Non-empty arrays become true
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBe(true);
    expect(rec2?.fields[fieldId]).toBe(true);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should convert empty arrays to null', async () => {
    // Setup: Create multipleSelect field with empty array
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Empty Multi Checkbox',
        options: {
          choices: [{ id: 'cho1', name: 'Red', color: 'redBright' }],
        },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: [] });

    // Action: Convert to checkbox
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'checkbox' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('checkbox');

    // Assert: Empty array becomes null
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    expect(rec1?.fields[fieldId]).toBeNull();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should handle null values', async () => {
    // Setup: Create multipleSelect field with null
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Null Multi Checkbox',
        options: {
          choices: [{ id: 'cho1', name: 'Red', color: 'redBright' }],
        },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' });

    // Action: Convert to checkbox
    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'checkbox' },
    });

    // Assert: null remains null
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    expect(rec1?.fields[fieldId]).toBeNull();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });
});
