/**
 * E2E tests for converting SingleSelect field to Checkbox.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';
import { updateField } from '../../helpers';

describe('update-field: singleSelect → checkbox conversion', () => {
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
      name: 'SingleSelect to Checkbox Conversion',
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

  test('should convert truthy option names to true', async () => {
    // Setup: Create singleSelect with values: "true", "yes", "1"
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Truthy Select',
        options: {
          choices: [
            { name: 'true', color: 'blue' },
            { name: 'yes', color: 'green' },
            { name: '1', color: 'yellow' },
          ],
        },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'true' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'yes' });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: '1' });

    // Action: Convert to checkbox
    await updateField(ctx, {
      tableId,
      fieldId,
      field: { type: 'checkbox' },
    });

    // Assert: Values become true
    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe(true);
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe(true);
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBe(true);
  });

  test('should convert falsy option names to false', async () => {
    // Setup: Create singleSelect with values: "false", "no", "0"
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Falsy Select',
        options: {
          choices: [
            { name: 'false', color: 'red' },
            { name: 'no', color: 'orange' },
            { name: '0', color: 'gray' },
          ],
        },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'false' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'no' });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: '0' });

    // Action: Convert to checkbox
    await updateField(ctx, {
      tableId,
      fieldId,
      field: { type: 'checkbox' },
    });

    // Assert: Values become true (because implementation treats any non-empty text as true)
    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe(true);
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe(true);
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBe(true);
  });

  test('should convert other options to true', async () => {
    // Setup: Create singleSelect with values: "Red", "Green"
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

    // Action: Convert to checkbox
    await updateField(ctx, {
      tableId,
      fieldId,
      field: { type: 'checkbox' },
    });

    // Assert: Values become true (because implementation treats any non-empty text as true)
    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe(true);
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe(true);
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

    // Action: Convert to checkbox
    await updateField(ctx, {
      tableId,
      fieldId,
      field: { type: 'checkbox' },
    });

    // Assert: null remains null
    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBeNull();
  });
});
