/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: number → rating conversion', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createNumberField = async (name: string) => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', id: fieldId, name },
    });
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Number to Rating Conversion',
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

  test('should clamp values to rating max', async () => {
    const fieldId = await createNumberField('Clamp Number Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 3 });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 10 });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: -2 });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'rating', max: 5 },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('rating');

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    const rec3 = records.find((r) => r.id === r3.id);
    expect(rec1?.fields[fieldId]).toBe(3);
    expect(rec2?.fields[fieldId]).toBe(5);
    expect(rec3?.fields[fieldId]).toBe(0);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should floor decimal values', async () => {
    const fieldId = await createNumberField('Decimal Number Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 3.7 });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 2.3 });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'rating', max: 5 },
    });

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBe(3);
    expect(rec2?.fields[fieldId]).toBe(2);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should map null values to max rating (current behavior)', async () => {
    const fieldId = await createNumberField('Nullable Number Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 4 });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'rating', max: 5 },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('rating');

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBe(4);
    expect(rec2?.fields[fieldId]).toBe(5);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should clamp negative values to 0', async () => {
    const fieldId = await createNumberField('Negative Number Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: -5 });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: -0.5 });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'rating', max: 5 },
    });

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBe(0);
    expect(rec2?.fields[fieldId]).toBe(0);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should preserve values within range', async () => {
    const fieldId = await createNumberField('Range Number Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 1 });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 2 });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 3 });
    const r4 = await ctx.createRecord(tableId, { [fieldId]: 4 });
    const r5 = await ctx.createRecord(tableId, { [fieldId]: 5 });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'rating', max: 5 },
    });

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    const rec3 = records.find((r) => r.id === r3.id);
    const rec4 = records.find((r) => r.id === r4.id);
    const rec5 = records.find((r) => r.id === r5.id);
    expect(rec1?.fields[fieldId]).toBe(1);
    expect(rec2?.fields[fieldId]).toBe(2);
    expect(rec3?.fields[fieldId]).toBe(3);
    expect(rec4?.fields[fieldId]).toBe(4);
    expect(rec5?.fields[fieldId]).toBe(5);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id, r4.id, r5.id]);
  });
});
