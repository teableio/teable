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

describe('update-field: longText → multipleSelect conversion', () => {
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
      name: 'LongText to multipleSelect conversion',
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

  test('should split comma-separated text to multiple values', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'longText', id: fieldId, name: 'LongText Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Tag1, Tag2' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'Tag1' });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'multipleSelect' },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toEqual(['Tag1', 'Tag2']);
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toEqual(['Tag1']);

    const refreshedTable = await ctx.getTableById(tableId);
    const refreshedField = refreshedTable.fields.find((f) => f.id === fieldId) as
      | SelectFieldLike
      | undefined;
    expect(getChoiceNames(refreshedField)).toEqual(['Tag1', 'Tag2']);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should split multi-line text into multiple options', async () => {
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
      field: { type: 'multipleSelect' },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toEqual(['Line 1', 'Line 2']);

    const refreshedTable = await ctx.getTableById(tableId);
    const refreshedField = refreshedTable.fields.find((f) => f.id === fieldId) as
      | SelectFieldLike
      | undefined;
    expect(getChoiceNames(refreshedField)).toEqual(['Line 1', 'Line 2']);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should handle null values', async () => {
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
      field: { type: 'multipleSelect' },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toEqual(['A']);
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBeNull();
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toEqual(['B']);

    const refreshedTable = await ctx.getTableById(tableId);
    const refreshedField = refreshedTable.fields.find((f) => f.id === fieldId) as
      | SelectFieldLike
      | undefined;
    expect(getChoiceNames(refreshedField)).toEqual(['A', 'B']);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should handle CSV-quoted commas in text (V1 parity)', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'longText', id: fieldId, name: 'CSV Quoted LongText' },
    });
    // V1 e2e test values:
    // 'x', 'x, y', 'x\nz', `x, "','"`, `x, y, ", "`, `"','", ", "`
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'x' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'x, y' });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 'x\nz' });
    const r4 = await ctx.createRecord(tableId, { [fieldId]: `x, "','"` });
    const r5 = await ctx.createRecord(tableId, { [fieldId]: `x, y, ", "` });
    const r6 = await ctx.createRecord(tableId, { [fieldId]: `"','", ", "` });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'multipleSelect' },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toEqual(['x']);
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toEqual(['x', 'y']);
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toEqual(['x', 'z']);
    expect(records.find((r) => r.id === r4.id)?.fields[fieldId]).toEqual(['x', "','"]);
    // r5: `x, y, ", "` → ['x', 'y', comma-with-optional-space]
    const r5val = records.find((r) => r.id === r5.id)?.fields[fieldId] as string[];
    expect(r5val).toEqual(expect.arrayContaining(['x', 'y']));
    expect(r5val).toEqual(expect.arrayContaining([expect.stringMatching(/^,\s?$/)]));
    // r6: `"','", ", "` → [','-with-quotes-stripped, comma-with-optional-space]
    const r6val = records.find((r) => r.id === r6.id)?.fields[fieldId] as string[];
    expect(r6val).toEqual(expect.arrayContaining(["','"]));
    expect(r6val).toEqual(expect.arrayContaining([expect.stringMatching(/^,\s?$/)]));

    // Verify expected choices exist
    const refreshedTable = await ctx.getTableById(tableId);
    const refreshedField = refreshedTable.fields.find((f) => f.id === fieldId) as
      | SelectFieldLike
      | undefined;
    const choiceNames = getChoiceNames(refreshedField);
    expect(choiceNames).toContain('x');
    expect(choiceNames).toContain('y');
    expect(choiceNames).toContain('z');
    expect(choiceNames).toContain("','");

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id, r4.id, r5.id, r6.id]);
  });
});
