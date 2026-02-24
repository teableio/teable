/**
 * E2E tests for converting SingleSelect field to LongText.
 *
 * Conversion behavior:
 * - singleSelect stores text, longText is text -> value preserved as-is
 * - Null values remain null
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: singleSelect → longText conversion', () => {
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
      name: 'SingleSelect to LongText Conversion',
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

  test('should convert select values to text', async () => {
    // Setup: Create singleSelect field with values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Select Field',
        options: {
          choices: [
            { id: 'cho1', name: 'Red', color: 'redBright' },
            { id: 'cho2', name: 'Blue', color: 'blueBright' },
          ],
        },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Red' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'Blue' });

    // Action: Convert to longText
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'longText' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('longText');

    // Assert: Values preserved as-is
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBe('Red');
    expect(rec2?.fields[fieldId]).toBe('Blue');

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should handle null values', async () => {
    // Setup: Create singleSelect field with null
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Null Select Field',
        options: {
          choices: [{ id: 'cho1', name: 'Red', color: 'redBright' }],
        },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Red' });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' });

    // Action: Convert to longText
    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'longText' },
    });

    // Assert: null remains null, value preserved
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBe('Red');
    expect(rec2?.fields[fieldId]).toBeNull();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });
});
