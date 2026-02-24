/**
 * E2E tests for converting SingleSelect field to Number.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';
import { updateField } from '../../helpers';

describe('update-field: singleSelect → number conversion', () => {
  let ctx: SharedTestContext;
  let tableId: string;
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
      name: 'SingleSelect to Number Conversion',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;
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

  test('should convert numeric options to numbers', async () => {
    // Setup: Create singleSelect with options: ["1", "2", "3"], values: "1", "2", "3"
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Numeric Select',
        options: {
          choices: [
            { name: '1', color: 'blue' },
            { name: '2', color: 'red' },
            { name: '3', color: 'green' },
          ],
        },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '1' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: '2' });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: '3' });

    // Action: Convert to number
    await updateField(ctx, {
      tableId,
      fieldId,
      field: { type: 'number' },
    });

    // Assert: Values become 1, 2, 3
    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe(1);
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe(2);
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBe(3);
  });

  test('should convert non-numeric options to null', async () => {
    // Setup: Create singleSelect with options: ["Red", "Green"], values: "Red", "Green"
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Color Select',
        options: {
          choices: [
            { name: 'Red', color: 'red' },
            { name: 'Green', color: 'green' },
          ],
        },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Red' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'Green' });

    // Action: Convert to number
    await updateField(ctx, {
      tableId,
      fieldId,
      field: { type: 'number' },
    });

    // Assert: Values become null
    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBeNull();
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBeNull();
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
        name: 'Null Test',
        options: {
          choices: [{ name: 'Option', color: 'blue' }],
        },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: null });

    // Action: Convert to number
    await updateField(ctx, {
      tableId,
      fieldId,
      field: { type: 'number' },
    });

    // Assert: null remains null
    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBeNull();
  });
});
