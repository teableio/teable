/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

type SelectFieldLike = {
  options?: {
    choices?: Array<{ id: string; name: string; color: string }>;
  };
};

const getChoices = (field?: SelectFieldLike) => field?.options?.choices ?? [];

describe('update-field: singleSelect → multipleSelect conversion', () => {
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
      name: 'singleSelect to multipleSelect conversion',
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

  test('should preserve all select option metadata when only one choice is used', async () => {
    const fieldId = createFieldId();
    const choices = [
      { id: 'choRed00000000001', name: 'Red', color: 'redBright' as const },
      { id: 'choGreen000000001', name: 'Green', color: 'greenBright' as const },
      { id: 'choUnused00000001', name: 'Unused', color: 'grayBright' as const },
    ];
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Single Select Field',
        options: { choices },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Red' });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No Select Value' });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'multipleSelect' },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toEqual(['Red']);
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBeNull();

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | SelectFieldLike
      | undefined;
    expect(getChoices(updatedField)).toEqual(choices);

    const refreshedTable = await ctx.getTableById(tableId);
    const refreshedField = refreshedTable.fields.find((f) => f.id === fieldId) as
      | SelectFieldLike
      | undefined;
    expect(getChoices(refreshedField)).toEqual(choices);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should keep null values as null', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Nullable Single Select Field',
        options: { choices: [{ name: 'Red', color: 'redBright' }] },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Red' });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No Select Value' });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'multipleSelect' },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toEqual(['Red']);
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });
});
