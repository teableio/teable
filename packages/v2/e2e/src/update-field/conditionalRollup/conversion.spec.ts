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

describe('update-field: conditionalRollup conversions', () => {
  let ctx: SharedTestContext;
  let hostTableId: string;
  let hostPrimaryFieldId: string;
  let foreignTableId: string;
  let foreignPrimaryFieldId: string;
  let foreignNumberFieldId: string;

  const createTextField = async (name: string) => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: { type: 'singleLineText', id: fieldId, name },
    });
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'CondRollup Conv Foreign',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', name: 'Amount' },
      ],
    });
    foreignTableId = foreignTable.id;
    const foreignPrimary = foreignTable.fields.find((f) => f.isPrimary);
    if (!foreignPrimary) throw new Error('No foreign primary field');
    foreignPrimaryFieldId = foreignPrimary.id;
    const amountField = foreignTable.fields.find((f) => f.name === 'Amount');
    if (!amountField) throw new Error('No foreign amount field');
    foreignNumberFieldId = amountField.id;

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'CondRollup Conv Host',
      fields: [{ type: 'singleLineText', name: 'Host Name', isPrimary: true }],
    });
    hostTableId = hostTable.id;
    const primaryField = hostTable.fields.find((f) => f.isPrimary);
    if (!primaryField) throw new Error('No host primary field');
    hostPrimaryFieldId = primaryField.id;
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

  test('should convert singleLineText to conditionalRollup', async () => {
    const fieldId = await createTextField('Text -> CondRollup');
    const rec = await ctx.createRecord(hostTableId, { [fieldId]: 'x' });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        type: 'conditionalRollup',
        cellValueType: 'number',
        isMultipleCellValue: false,
        options: {
          expression: 'sum({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'Seed'),
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('conditionalRollup');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [rec.id]);
  });

  test('should convert conditionalRollup to singleLineText', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalRollup',
        id: fieldId,
        name: 'CondRollup -> Text',
        options: {
          expression: 'sum({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'Seed'),
        },
      },
    });
    const rec = await ctx.createRecord(hostTableId, { [hostPrimaryFieldId]: 'A' });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('singleLineText');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [rec.id]);
  });

  test('should convert conditionalRollup to conditionalLookup', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalRollup',
        id: fieldId,
        name: 'CondRollup -> CondLookup',
        options: {
          expression: 'sum({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'Seed'),
        },
      },
    });
    const rec = await ctx.createRecord(hostTableId, { [hostPrimaryFieldId]: 'A' });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        type: 'conditionalLookup',
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'Seed'),
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | { isLookup?: boolean; conditionalLookupOptions?: unknown }
      | undefined;
    expect(updatedField?.isLookup).toBe(true);
    expect(updatedField?.conditionalLookupOptions).toBeTruthy();

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [rec.id]);
  });

  test('should convert number to conditionalRollup', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: { type: 'number', id: fieldId, name: 'Num -> CondRollup' },
    });
    const rec = await ctx.createRecord(hostTableId, { [fieldId]: 42 });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        type: 'conditionalRollup',
        cellValueType: 'number',
        isMultipleCellValue: false,
        options: {
          expression: 'sum({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'Seed'),
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('conditionalRollup');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [rec.id]);
  });
});
