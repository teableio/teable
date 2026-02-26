/**
 * E2E tests for converting SingleSelect field to Rating.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';
import { updateField } from '../../helpers';

describe('update-field: singleSelect → rating conversion', () => {
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
      name: 'SingleSelect to Rating Conversion',
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

  test('should convert numeric options to ratings', async () => {
    // Setup: Create singleSelect with options: ["1", "2", "3", "4", "5"]
    // Values: "3", "5"
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
            { name: '4', color: 'yellow' },
            { name: '5', color: 'purple' },
          ],
        },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '3' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: '5' });

    // Action: Convert to rating with max: 5
    await updateField(ctx, {
      tableId,
      fieldId,
      field: { type: 'rating', options: { max: 5, icon: 'star', color: 'yellowBright' } },
    });

    // Assert: Values become 3, 5
    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe(3);
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe(5);
  });

  test('should clamp values exceeding max', async () => {
    // Setup: Create singleSelect with options: ["10", "15"]
    // Values: "10", "15"
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Large Numeric Select',
        options: {
          choices: [
            { name: '10', color: 'blue' },
            { name: '15', color: 'red' },
          ],
        },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '10' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: '15' });

    // Action: Convert to rating with max: 5
    await updateField(ctx, {
      tableId,
      fieldId,
      field: { type: 'rating', options: { max: 5, icon: 'star', color: 'yellowBright' } },
    });

    // Assert: Values become 5, 5 (clamped)
    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe(5);
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe(5);
  });

  test('should convert non-numeric options to null', async () => {
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

    // Action: Convert to rating
    await updateField(ctx, {
      tableId,
      fieldId,
      field: { type: 'rating' },
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

    // Action: Convert to rating
    await updateField(ctx, {
      tableId,
      fieldId,
      field: { type: 'rating' },
    });

    // Assert: null remains null
    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBeNull();
  });
});
