/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: number → date conversion', () => {
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
      name: 'Number to Date Conversion',
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

  test('should interpret as Unix timestamp milliseconds', async () => {
    const fieldId = await createNumberField('Timestamp Ms Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 1704067200000 });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'date' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('date');

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    expect(rec1?.fields[fieldId]).toMatch(/^2024-01-01/);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should handle timestamp in seconds as milliseconds input', async () => {
    const fieldId = await createNumberField('Timestamp Seconds Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 1704067200 });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'date' },
    });

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const value = rec1?.fields[fieldId];
    expect(value).toEqual(expect.any(String));
    const parsed = new Date(String(value));
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(parsed.getUTCFullYear()).toBe(1970);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should handle null values', async () => {
    const fieldId = await createNumberField('Nullable Number Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 1704067200000 });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'date' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('date');

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toMatch(/^2024-01-01/);
    expect(rec2?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should handle negative timestamps', async () => {
    const fieldId = await createNumberField('Negative Timestamp Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: -86400000 });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'date' },
    });

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const value = rec1?.fields[fieldId];
    expect(value).toEqual(expect.any(String));
    const parsed = new Date(String(value));
    expect(parsed.getUTCFullYear()).toBe(1969);
    expect(parsed.getUTCMonth()).toBe(11);
    expect(parsed.getUTCDate()).toBe(31);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should handle zero timestamp', async () => {
    const fieldId = await createNumberField('Epoch Timestamp Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 0 });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'date' },
    });

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const value = rec1?.fields[fieldId];
    expect(value).toEqual(expect.any(String));
    const parsed = new Date(String(value));
    expect(parsed.getUTCFullYear()).toBe(1970);
    expect(parsed.getUTCMonth()).toBe(0);
    expect(parsed.getUTCDate()).toBe(1);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });
});
