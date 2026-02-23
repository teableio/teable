/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: longText → number conversion', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createLongTextField = async (name: string) => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'longText', id: fieldId, name },
    });
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'LongText to Number Conversion',
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
        void 0;
      }
    }
  });

  test('should convert numeric strings to numbers', async () => {
    const fieldId = await createLongTextField('Numeric LongText Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '123' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: '45.67' });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: '-89' });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'number' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('number');

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    const rec3 = records.find((r) => r.id === r3.id);
    expect(rec1?.fields[fieldId]).toBe(123);
    expect(rec2?.fields[fieldId]).toBe(45.67);
    expect(rec3?.fields[fieldId]).toBe(-89);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should convert non-numeric strings to null', async () => {
    const fieldId = await createLongTextField('NonNumeric LongText Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'hello' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'Line 1\nLine 2' });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'number' },
    });

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBeNull();
    expect(rec2?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should handle null values', async () => {
    const fieldId = await createLongTextField('Nullable LongText Number Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '42' });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'number' },
    });

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBe(42);
    expect(rec2?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should handle numeric string with surrounding text', async () => {
    const fieldId = await createLongTextField('Surrounded Numeric Text Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'The number is 42' });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'number' },
    });

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    expect(rec1?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });
});
