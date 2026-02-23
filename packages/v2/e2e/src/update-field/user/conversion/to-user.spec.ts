/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: user → user conversion (isMultiple toggle)', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createUserField = async (name: string, isMultiple: boolean) => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'user',
        id: fieldId,
        name,
        options: {
          isMultiple,
          shouldNotify: false,
        },
      },
    });
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'User to User Conversion',
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

  test('should wrap single user in array when enabling isMultiple', async () => {
    const fieldId = await createUserField('Single User Field', false);
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: { id: 'system', title: 'System' },
    });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'user', options: { isMultiple: true, shouldNotify: false } },
    });

    const records = await ctx.listRecords(tableId);
    const value = records.find((r) => r.id === r1.id)?.fields[fieldId] as
      | Array<{ id: string; title?: string }>
      | null
      | undefined;
    expect(Array.isArray(value)).toBe(true);
    expect(value?.[0]).toMatchObject({ id: 'system' });

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should unwrap array to first user when disabling isMultiple', async () => {
    const fieldId = await createUserField('Multiple User Field', true);
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: [
        { id: 'system', title: 'System' },
        { id: 'usrTestUserId', title: 'Test User' },
      ],
    });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'user', options: { isMultiple: false, shouldNotify: false } },
    });

    const records = await ctx.listRecords(tableId);
    const value = records.find((r) => r.id === r1.id)?.fields[fieldId] as
      | { id: string; title?: string }
      | null
      | undefined;
    expect(Array.isArray(value)).toBe(false);
    expect(value).toMatchObject({ id: 'system' });

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should handle null values during isMultiple toggle', async () => {
    const fieldId = await createUserField('Nullable User Field', false);
    const r1 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'user', options: { isMultiple: true, shouldNotify: false } },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should preserve single user when only shouldNotify changes', async () => {
    const fieldId = await createUserField('Single User Same Format Field', false);
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: { id: 'system', title: 'System' },
    });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'user', options: { isMultiple: false, shouldNotify: true } },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toMatchObject({ id: 'system' });

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should preserve array when only shouldNotify changes', async () => {
    const fieldId = await createUserField('Multiple User Same Format Field', true);
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: [{ id: 'system', title: 'System' }],
    });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'user', options: { isMultiple: true, shouldNotify: true } },
    });

    const records = await ctx.listRecords(tableId);
    const value = records.find((r) => r.id === r1.id)?.fields[fieldId] as
      | Array<{ id: string; title?: string }>
      | null
      | undefined;
    expect(Array.isArray(value)).toBe(true);
    expect(value?.[0]).toMatchObject({ id: 'system' });

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should keep empty array when disabling isMultiple', async () => {
    const fieldId = await createUserField('Empty Array User Field', true);
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: [],
    });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'user', options: { isMultiple: false, shouldNotify: false } },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toEqual([]);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });
});
