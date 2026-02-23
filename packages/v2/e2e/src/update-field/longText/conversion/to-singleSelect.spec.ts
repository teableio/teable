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

describe('update-field: longText → singleSelect conversion', () => {
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
      name: 'LongText to singleSelect conversion',
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

  test('should convert text to options with auto-generation', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'longText', id: fieldId, name: 'LongText Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Option A' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'Option B' });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 'Option A' });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleSelect' },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe('Option A');
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe('Option B');
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBe('Option A');

    const refreshedTable = await ctx.getTableById(tableId);
    const refreshedField = refreshedTable.fields.find((f) => f.id === fieldId) as
      | SelectFieldLike
      | undefined;
    expect(getChoiceNames(refreshedField)).toEqual(['Option A', 'Option B']);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should replace newlines with spaces for singleSelect value', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'longText', id: fieldId, name: 'Multiline LongText Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Line 1\nLine 2' });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleSelect' },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe('Line 1 Line 2');

    const refreshedTable = await ctx.getTableById(tableId);
    const refreshedField = refreshedTable.fields.find((f) => f.id === fieldId) as
      | SelectFieldLike
      | undefined;
    expect(getChoiceNames(refreshedField)).toEqual(['Line 1 Line 2']);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should handle null and empty values', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'longText', id: fieldId, name: 'Nullable LongText Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'A' });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No LongText Value' });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 'B' });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleSelect' },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe('A');
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBeNull();
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBe('B');

    const refreshedTable = await ctx.getTableById(tableId);
    const refreshedField = refreshedTable.fields.find((f) => f.id === fieldId) as
      | SelectFieldLike
      | undefined;
    expect(getChoiceNames(refreshedField)).toEqual(['A', 'B']);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });
});
