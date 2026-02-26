/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

type SelectFieldLike = {
  options?: {
    choices?: Array<{ name: string }>;
  };
};

const getChoiceNames = (field?: SelectFieldLike) =>
  (field?.options?.choices ?? []).map((c) => c.name).sort();

describe('update-field: multipleSelect → singleSelect conversion', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;
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
      name: 'multipleSelect to singleSelect conversion',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;
    const primaryField = table.fields.find((f) => f.isPrimary);
    if (!primaryField) throw new Error('No primary field');
    primaryFieldId = primaryField.id;
  });

  afterAll(async () => {
    if (!tableId) return;
    await ctx.deleteTable(tableId).catch(() => undefined);
  });

  test('should take first element from array and preserve options', async () => {
    const fieldId = createFieldId();
    const choices = [
      { name: 'Red', color: 'redBright' as const },
      { name: 'Green', color: 'greenBright' as const },
      { name: 'Blue', color: 'blueBright' as const },
    ];
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Multiple Select Field',
        options: { choices },
      },
    });

    const r1 = await ctx.createRecord(tableId, { [fieldId]: ['Red', 'Green'] });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: ['Blue'] });
    const r3 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No Select Value' });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleSelect' },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe('Red');
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe('Blue');
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBeNull();

    const refreshedTable = await ctx.getTableById(tableId);
    const refreshedField = refreshedTable.fields.find((f) => f.id === fieldId) as
      | SelectFieldLike
      | undefined;
    expect(getChoiceNames(refreshedField)).toEqual(['Blue', 'Green', 'Red']);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should handle empty arrays as null', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Empty Array Multiple Select Field',
        options: { choices: [{ name: 'Red', color: 'redBright' }] },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: [] });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No Select Value' });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleSelect' },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBeNull();
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });
});
