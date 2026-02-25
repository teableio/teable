/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: rating → user conversion', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createRatingField = async (name: string) => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'rating',
        id: fieldId,
        name,
        options: { max: 5, icon: 'star', color: 'yellowBright' },
      },
    });
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Rating to User Conversion',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;
    const primaryField = table.fields.find((f) => f.isPrimary);
    if (!primaryField) throw new Error('No primary field');
    primaryFieldId = primaryField.id;
  });

  afterAll(async () => {
    if (!tableId) return;
    try {
      await ctx.deleteTable(tableId);
    } catch {}
  });

  test('should convert non-null values to null', async () => {
    const fieldId = await createRatingField('Rating Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 4 });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 1 });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'user' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('user');

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBeNull();
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should keep null values as null', async () => {
    const fieldId = await createRatingField('Nullable Rating Field');
    const r1 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'user' },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });
});
