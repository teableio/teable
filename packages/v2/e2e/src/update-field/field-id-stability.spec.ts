/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../shared/globalTestContext';

let fieldIdCounter = 0;
const createFieldId = () => {
  const suffix = fieldIdCounter.toString(36).padStart(16, '0');
  fieldIdCounter += 1;
  return `fld${suffix}`;
};

describe('update-field: field ID stability', () => {
  let ctx: SharedTestContext;
  let tableId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    // Create a test table
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'FieldIDStability',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    try {
      if (tableId) await ctx.deleteTable(tableId);
    } catch {
      // ignore cleanup failure
    }
  });

  test('should preserve field ID when converting number to single select', async () => {
    const originalFieldId = createFieldId();

    // Create a number field
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'number',
        id: originalFieldId,
        name: 'Amount',
      },
    });

    // Convert to single select
    const convertedTable = await ctx.updateField({
      tableId,
      fieldId: originalFieldId,
      field: {
        type: 'singleSelect',
        name: 'Amount (Select)',
        options: {
          choices: [{ name: 'Option 1' }, { name: 'Option 2' }],
        },
      },
    });

    // Verify the field ID is preserved
    const convertedField = convertedTable.fields.find((f) => f.id === originalFieldId);
    expect(convertedField).toBeDefined();
    expect(convertedField?.id).toBe(originalFieldId);
    expect(convertedField?.type).toBe('singleSelect');

    // Cleanup
    await ctx.deleteField({ tableId, fieldId: originalFieldId });
  });

  test('should preserve field ID when converting single line text to long text', async () => {
    const originalFieldId = createFieldId();

    // Create a single line text field
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleLineText',
        id: originalFieldId,
        name: 'Description',
      },
    });

    // Convert to long text
    const convertedTable = await ctx.updateField({
      tableId,
      fieldId: originalFieldId,
      field: {
        type: 'longText',
        name: 'Description (Long)',
      },
    });

    // Verify the field ID is preserved
    const convertedField = convertedTable.fields.find((f) => f.id === originalFieldId);
    expect(convertedField).toBeDefined();
    expect(convertedField?.id).toBe(originalFieldId);
    expect(convertedField?.type).toBe('longText');

    // Cleanup
    await ctx.deleteField({ tableId, fieldId: originalFieldId });
  });

  test('should preserve field ID when updating field properties without type conversion', async () => {
    const originalFieldId = createFieldId();

    // Create a number field
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'number',
        id: originalFieldId,
        name: 'Score',
        options: {
          formatting: { type: 'decimal', precision: 0 },
        },
      },
    });

    // Update formatting
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId: originalFieldId,
      field: {
        options: {
          formatting: { type: 'decimal', precision: 2 },
        },
      },
    });

    // Verify the field ID is preserved
    const updatedField = updatedTable.fields.find((f) => f.id === originalFieldId);
    expect(updatedField).toBeDefined();
    expect(updatedField?.id).toBe(originalFieldId);
    expect(updatedField?.type).toBe('number');

    // Cleanup
    await ctx.deleteField({ tableId, fieldId: originalFieldId });
  });
});
