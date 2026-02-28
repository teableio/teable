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

describe('update-field: number → singleSelect conversion', () => {
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
      name: 'Number to singleSelect conversion',
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

  test('should convert numbers to text options with auto-generation', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', id: fieldId, name: 'Number Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 1 });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 2 });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 1 });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleSelect' },
    });
    expect(updatedTable.fields.find((f) => f.id === fieldId)?.type).toBe('singleSelect');

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe('1');
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe('2');
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBe('1');

    const refreshedTable = await ctx.getTableById(tableId);
    const refreshedField = refreshedTable.fields.find((f) => f.id === fieldId) as
      | SelectFieldLike
      | undefined;
    expect(getChoiceNames(refreshedField)).toEqual(['1', '2']);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should handle decimal numbers in options', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', id: fieldId, name: 'Decimal Number Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 1.5 });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 2.75 });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 1.5 });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleSelect' },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe('1.5');
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe('2.75');
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBe('1.5');

    const refreshedTable = await ctx.getTableById(tableId);
    const refreshedField = refreshedTable.fields.find((f) => f.id === fieldId) as
      | SelectFieldLike
      | undefined;
    expect(getChoiceNames(refreshedField)).toEqual(['1.5', '2.75']);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should handle null values', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', id: fieldId, name: 'Nullable Number Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 1 });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No Number Value' });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 2 });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleSelect' },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe('1');
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBeNull();
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBe('2');

    const refreshedTable = await ctx.getTableById(tableId);
    const refreshedField = refreshedTable.fields.find((f) => f.id === fieldId) as
      | SelectFieldLike
      | undefined;
    expect(getChoiceNames(refreshedField)).toEqual(['1', '2']);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should merge with existing options', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', id: fieldId, name: 'Merge Number Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 1 });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 2 });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 3 });

    await ctx.updateField({
      tableId,
      fieldId,
      field: {
        type: 'singleSelect',
        options: {
          choices: [
            { name: '1', color: 'redBright' },
            { name: '4', color: 'blueBright' },
          ],
        },
      },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe('1');
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe('2');
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBe('3');

    const refreshedTable = await ctx.getTableById(tableId);
    const refreshedField = refreshedTable.fields.find((f) => f.id === fieldId) as
      | SelectFieldLike
      | undefined;
    expect(getChoiceNames(refreshedField)).toEqual(['1', '2', '3', '4']);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });
});
