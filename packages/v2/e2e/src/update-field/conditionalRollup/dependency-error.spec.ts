/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

let fieldIdCounter = 0;
const createFieldId = () => {
  const suffix = fieldIdCounter.toString(36).padStart(16, '0');
  fieldIdCounter += 1;
  return `fld${suffix}`;
};

const makeCondition = (fieldId: string, value: string) => ({
  filter: {
    conjunction: 'and' as const,
    filterSet: [{ fieldId, operator: 'is', value }],
  },
});

describe('update-field: conditionalRollup dependency errors', () => {
  let ctx: SharedTestContext;
  let hostTableId: string;
  let foreignTableId: string;
  let foreignPrimaryFieldId: string;
  let foreignNumberFieldId: string;
  let foreignStatusFieldId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const statusFieldId = createFieldId();
    const numberFieldId = createFieldId();

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'CondRollup DepErr Foreign',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', name: 'Amount', id: numberFieldId },
        { type: 'singleLineText', name: 'Status', id: statusFieldId },
      ],
    });
    foreignTableId = foreignTable.id;
    const foreignPrimary = foreignTable.fields.find((f) => f.isPrimary);
    if (!foreignPrimary) throw new Error('No foreign primary field');
    foreignPrimaryFieldId = foreignPrimary.id;
    foreignNumberFieldId = numberFieldId;
    foreignStatusFieldId = statusFieldId;

    // Seed records
    await ctx.createRecords(foreignTableId, [
      { fields: { Name: 'Alpha', [numberFieldId]: 2, [statusFieldId]: 'Active' } },
      { fields: { Name: 'Beta', [numberFieldId]: 4, [statusFieldId]: 'Active' } },
      { fields: { Name: 'Gamma', [numberFieldId]: 6, [statusFieldId]: 'Inactive' } },
    ]);

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'CondRollup DepErr Host',
      fields: [{ type: 'singleLineText', name: 'Host Name', isPrimary: true }],
    });
    hostTableId = hostTable.id;
  });

  afterAll(async () => {
    try {
      if (hostTableId) await ctx.deleteTable(hostTableId);
    } catch {
      // ignore cleanup failure
    }
    try {
      if (foreignTableId) await ctx.deleteTable(foreignTableId);
    } catch {
      // ignore cleanup failure
    }
  });

  test('marks hasError when filter-referenced field is deleted', async () => {
    const fieldId = createFieldId();

    // Create conditional rollup with filter referencing Status field
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalRollup',
        id: fieldId,
        name: 'CR HasError Test',
        options: {
          expression: 'sum({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
          condition: makeCondition(foreignStatusFieldId, 'Active'),
        },
      },
    });

    // Verify the field was created successfully
    const tableBefore = await ctx.getTableById(hostTableId);
    const fieldBefore = tableBefore.fields.find((f) => f.id === fieldId);
    expect(fieldBefore?.type).toBe('conditionalRollup');
    expect(fieldBefore?.hasError).toBeFalsy();

    // Delete the Status field from the foreign table
    await ctx.deleteField({ tableId: foreignTableId, fieldId: foreignStatusFieldId });

    // Verify the conditional rollup field now has an error
    const tableAfter = await ctx.getTableById(hostTableId);
    const fieldAfter = tableAfter.fields.find((f) => f.id === fieldId);
    expect(fieldAfter?.type).toBe('conditionalRollup');
    expect(fieldAfter?.hasError).toBe(true);

    // Cleanup
    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });

  test('updates references when filter condition changes to reference a new field', async () => {
    // Create a second status-like field in the foreign table
    const extraFieldId = createFieldId();
    const extraTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: foreignTableId,
      field: {
        type: 'singleLineText',
        id: extraFieldId,
        name: 'Category',
      },
    });

    const fieldId = createFieldId();

    // Create conditional rollup with filter referencing the primary field
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalRollup',
        id: fieldId,
        name: 'CR Ref Update Test',
        options: {
          expression: 'sum({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'Alpha'),
        },
      },
    });

    // Update the filter to reference a different field (Category)
    await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        config: {
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
          condition: makeCondition(extraFieldId, 'SomeCategory'),
        },
      },
    });

    // Now delete the Category field - the conditional rollup should get hasError
    await ctx.deleteField({ tableId: foreignTableId, fieldId: extraFieldId });

    const tableAfter = await ctx.getTableById(hostTableId);
    const fieldAfter = tableAfter.fields.find((f) => f.id === fieldId);
    expect(fieldAfter?.type).toBe('conditionalRollup');
    expect(fieldAfter?.hasError).toBe(true);

    // Cleanup
    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });
});
