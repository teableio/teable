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

describe('update-field: conditionalRollup aggregation type conversion', () => {
  let ctx: SharedTestContext;
  let hostTableId: string;
  let foreignTableId: string;
  let foreignDateFieldId: string;
  let foreignPrimaryFieldId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    // Create foreign table with date field
    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'AggConv_Foreign',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        {
          type: 'date',
          name: 'Occurred On',
          options: { formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' } },
        },
      ],
    });
    foreignTableId = foreignTable.id;
    const foreignPrimary = foreignTable.fields.find((f) => f.isPrimary);
    const dateField = foreignTable.fields.find((f) => f.name === 'Occurred On');
    if (!foreignPrimary || !dateField) {
      throw new Error('Foreign fields not created');
    }
    foreignPrimaryFieldId = foreignPrimary.id;
    foreignDateFieldId = dateField.id;

    // Create host table
    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'AggConv_Host',
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

  test('should convert from count to datetime max aggregation without errors', async () => {
    const rollupFieldId = createFieldId();

    // Create conditional rollup with count aggregation (returns number)
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalRollup',
        id: rollupFieldId,
        name: 'Event Count',
        options: {
          expression: 'count({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId,
          lookupFieldId: foreignDateFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'Test'),
        },
      },
    });

    // Update to datetime max aggregation (returns datetime)
    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId: rollupFieldId,
      field: {
        name: 'Latest Event',
        options: {
          expression: 'max({values})',
          timeZone: 'utc',
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === rollupFieldId) as
      | { type?: string; cellValueType?: string; options?: { expression?: string } }
      | undefined;

    expect(updatedField?.type).toBe('conditionalRollup');
    expect(updatedField?.options?.expression).toBe('max({values})');
    expect(updatedField?.cellValueType).toBe('dateTime');

    // Cleanup
    await ctx.deleteField({ tableId: hostTableId, fieldId: rollupFieldId });
  });

  test('should convert from sum to count aggregation without errors', async () => {
    // Create a number field for sum aggregation
    const numField = await ctx.createField({
      baseId: ctx.baseId,
      tableId: foreignTableId,
      field: {
        type: 'number',
        name: 'Amount',
      },
    });
    const foreignTable = await ctx.getTableById(foreignTableId);
    const amountFieldId = foreignTable.fields.find((f) => f.name === 'Amount')?.id;
    if (!amountFieldId) throw new Error('Amount field not created');

    const rollupFieldId = createFieldId();

    // Create conditional rollup with sum aggregation (returns number)
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalRollup',
        id: rollupFieldId,
        name: 'Total Amount',
        options: {
          expression: 'sum({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId,
          lookupFieldId: amountFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'Test'),
        },
      },
    });

    // Update to count aggregation (still returns number, should work fine)
    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId: rollupFieldId,
      field: {
        options: {
          expression: 'count({values})',
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === rollupFieldId) as
      | { options?: { expression?: string } }
      | undefined;

    expect(updatedField?.options?.expression).toBe('count({values})');

    // Cleanup
    await ctx.deleteField({ tableId: hostTableId, fieldId: rollupFieldId });
    await ctx.deleteField({ tableId: foreignTableId, fieldId: amountFieldId });
  });
});
