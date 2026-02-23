/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

let globalFieldIdCounter = 0;
const createGlobalFieldId = () => {
  const suffix = globalFieldIdCounter.toString(36).padStart(16, '0');
  globalFieldIdCounter += 1;
  return `fld${suffix}`;
};

const makeCondition = (fieldId: string, value: string) => ({
  filter: {
    conjunction: 'and' as const,
    filterSet: [{ fieldId, operator: 'is', value }],
  },
});

describe('update-field: computed/system conversions (source + target)', () => {
  let ctx: SharedTestContext;
  let hostTableId: string;
  let hostPrimaryFieldId: string;
  let foreignTableId: string;
  let foreignPrimaryFieldId: string;
  let foreignNumberFieldId: string;

  const createTextField = async (name: string) => {
    const fieldId = createGlobalFieldId();
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
      name: 'Computed Conversion Foreign',
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
      name: 'Computed Conversion Host',
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

  test('should convert singleLineText to createdTime', async () => {
    const fieldId = await createTextField('Text -> CreatedTime');
    const rec = await ctx.createRecord(hostTableId, { [fieldId]: 'x' });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: { type: 'createdTime' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('createdTime');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [rec.id]);
  });

  test('should convert createdTime to singleLineText', async () => {
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: { type: 'createdTime', id: fieldId, name: 'CreatedTime Source' },
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

  test('should convert singleLineText to lastModifiedTime', async () => {
    const fieldId = await createTextField('Text -> LastModifiedTime');
    const rec = await ctx.createRecord(hostTableId, { [fieldId]: 'x' });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: { type: 'lastModifiedTime', options: { trackedFieldIds: [hostPrimaryFieldId] } },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('lastModifiedTime');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [rec.id]);
  });

  test('should convert lastModifiedTime to singleLineText', async () => {
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'lastModifiedTime',
        id: fieldId,
        name: 'LastModifiedTime Source',
        options: { trackedFieldIds: [hostPrimaryFieldId] },
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

  test('should convert singleLineText to createdBy', async () => {
    const fieldId = await createTextField('Text -> CreatedBy');
    const rec = await ctx.createRecord(hostTableId, { [fieldId]: 'x' });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: { type: 'createdBy' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('createdBy');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [rec.id]);
  });

  test('should convert createdBy to singleLineText', async () => {
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: { type: 'createdBy', id: fieldId, name: 'CreatedBy Source' },
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

  test('should convert singleLineText to lastModifiedBy', async () => {
    const fieldId = await createTextField('Text -> LastModifiedBy');
    const rec = await ctx.createRecord(hostTableId, { [fieldId]: 'x' });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: { type: 'lastModifiedBy', options: { trackedFieldIds: [hostPrimaryFieldId] } },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('lastModifiedBy');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [rec.id]);
  });

  test('should convert lastModifiedBy to singleLineText', async () => {
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'lastModifiedBy',
        id: fieldId,
        name: 'LastModifiedBy Source',
        options: { trackedFieldIds: [hostPrimaryFieldId] },
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

  test('should convert singleLineText to autoNumber', async () => {
    const fieldId = await createTextField('Text -> AutoNumber');
    const rec1 = await ctx.createRecord(hostTableId, { [fieldId]: 'x' });
    const rec2 = await ctx.createRecord(hostTableId, {});

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: { type: 'autoNumber' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField).toMatchObject({
      type: 'autoNumber',
      isComputed: true,
    });

    // Verify autoNumber values are sequentially assigned (integers, rec1 < rec2)
    const records = await ctx.listRecords(hostTableId);
    const rec1Data = records.find((r) => r.id === rec1.id);
    const rec2Data = records.find((r) => r.id === rec2.id);
    const val1 = rec1Data?.fields[fieldId] as number;
    const val2 = rec2Data?.fields[fieldId] as number;
    expect(Number.isInteger(val1)).toBe(true);
    expect(Number.isInteger(val2)).toBe(true);
    expect(val2).toEqual(val1 + 1);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [rec1.id, rec2.id]);
  });

  test('should convert autoNumber to singleLineText', async () => {
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: { type: 'autoNumber', id: fieldId, name: 'AutoNumber Source' },
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

  test('should convert singleLineText to conditionalLookup', async () => {
    const fieldId = await createTextField('Text -> ConditionalLookup');
    const rec = await ctx.createRecord(hostTableId, { [fieldId]: 'x' });

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

  test('should convert conditionalLookup to singleLineText', async () => {
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalLookup',
        id: fieldId,
        name: 'ConditionalLookup Source',
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
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

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | { type?: string; isLookup?: boolean }
      | undefined;
    expect(updatedField?.type).toBe('singleLineText');
    expect(updatedField?.isLookup).not.toBe(true);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [rec.id]);
  });

  test('should convert singleLineText to conditionalRollup', async () => {
    const fieldId = await createTextField('Text -> ConditionalRollup');
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
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalRollup',
        id: fieldId,
        name: 'ConditionalRollup Source',
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
});
