/* eslint-disable @typescript-eslint/naming-convention */
import type { IFieldDto } from '@teable/v2-contract-http';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

type LongTextFieldDto = IFieldDto & {
  type: 'longText';
  options?: {
    defaultValue?: string;
  };
};

const isLongTextField = (field: IFieldDto): field is LongTextFieldDto => {
  return field.type === 'longText';
};

type SelectFieldLike = {
  options?: {
    choices?: Array<{ name: string }>;
  };
};

const getChoiceNames = (field?: SelectFieldLike) =>
  (field?.options?.choices ?? []).map((c) => c.name).sort();

describe('update-field: longText property updates', () => {
  let ctx: SharedTestContext;
  let tableId: string;
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
      name: 'LongText Update Test',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;
    const primaryField = table.fields.find((f) => f.isPrimary);
    if (!primaryField) throw new Error('No primary field');
  });

  afterAll(async () => {
    if (tableId) {
      try {
        await ctx.deleteTable(tableId);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  test('should update field name', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'longText', id: fieldId, name: 'Description' },
    });

    const record1 = await ctx.createRecord(tableId, { [fieldId]: 'Line 1\nLine 2' });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { name: 'Details' },
    });

    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(field).toBeDefined();
    expect(field?.name).toBe('Details');
    expect(field?.type).toBe('longText');

    const records = await ctx.listRecordsWithoutDrain(tableId);
    const r1 = records.find((r) => r.id === record1.id);
    expect(r1?.fields[fieldId]).toBe('Line 1\nLine 2');

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [record1.id]);
  });

  test('should set defaultValue', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'longText', id: fieldId, name: 'Default Test' },
    });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { defaultValue: 'Default content\nLine 2' } },
    });

    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(field).toBeDefined();
    expect(isLongTextField(field!)).toBe(true);
    if (isLongTextField(field!)) {
      expect(field.options?.defaultValue).toBe('Default content\nLine 2');
    }

    await ctx.deleteField({ tableId, fieldId });
  });

  test('should clear defaultValue', async () => {
    // Setup: Create longText field with defaultValue
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'longText',
        id: fieldId,
        name: 'Clear Default',
        options: { defaultValue: 'Initial' },
      },
    });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { name: 'Cleared Default', options: { defaultValue: '' } },
    });

    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(field).toBeDefined();
    expect(field?.name).toBe('Cleared Default');
    expect(isLongTextField(field!)).toBe(true);
    if (isLongTextField(field!)) {
      expect(field.options?.defaultValue).toBeFalsy();
    }

    await ctx.deleteField({ tableId, fieldId });
  });

  describe('update-field: longText conversions', () => {
    test('should convert longText to singleLineText', async () => {
      const fieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'longText', id: fieldId, name: 'LT to SLT' },
      });
      const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Line 1\nLine 2' });
      const r2 = await ctx.createRecord(tableId, { [fieldId]: 'Single line' });

      await ctx.updateField({
        tableId,
        fieldId,
        field: { type: 'singleLineText' },
      });

      const records = await ctx.listRecordsWithoutDrain(tableId);
      expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe('Line 1 Line 2');
      expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe('Single line');

      await ctx.deleteField({ tableId, fieldId });
      await ctx.deleteRecords(tableId, [r1.id, r2.id]);
    });

    test('should convert longText to number', async () => {
      const fieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'longText', id: fieldId, name: 'LT to Num' },
      });
      const r1 = await ctx.createRecord(tableId, { [fieldId]: '123' });
      const r2 = await ctx.createRecord(tableId, { [fieldId]: '456.78' });
      const r3 = await ctx.createRecord(tableId, { [fieldId]: 'not a number\nline 2' });

      await ctx.updateField({
        tableId,
        fieldId,
        field: { type: 'number' },
      });

      const records = await ctx.listRecordsWithoutDrain(tableId);
      expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe(123);
      expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe(456.78);
      expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBeNull();

      await ctx.deleteField({ tableId, fieldId });
      await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
    });

    test('should convert longText to singleSelect with option generation', async () => {
      const fieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'longText', id: fieldId, name: 'LT to SS' },
      });
      const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Option A' });
      const r2 = await ctx.createRecord(tableId, { [fieldId]: 'Option B' });
      const r3 = await ctx.createRecord(tableId, { [fieldId]: 'Option A' });

      await ctx.updateField({
        tableId,
        fieldId,
        field: { type: 'singleSelect' },
      });

      const records = await ctx.listRecordsWithoutDrain(tableId);
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

    test('should convert longText to multipleSelect with option generation', async () => {
      const fieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'longText', id: fieldId, name: 'LT to MS' },
      });
      const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Tag1' });
      const r2 = await ctx.createRecord(tableId, { [fieldId]: 'Tag2' });
      const r3 = await ctx.createRecord(tableId, { [fieldId]: 'Tag1' });

      await ctx.updateField({
        tableId,
        fieldId,
        field: { type: 'multipleSelect' },
      });

      const records = await ctx.listRecordsWithoutDrain(tableId);
      expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toEqual(['Tag1']);
      expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toEqual(['Tag2']);
      expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toEqual(['Tag1']);

      const refreshedTable = await ctx.getTableById(tableId);
      const refreshedField = refreshedTable.fields.find((f) => f.id === fieldId) as
        | SelectFieldLike
        | undefined;
      expect(getChoiceNames(refreshedField)).toEqual(['Tag1', 'Tag2']);

      await ctx.deleteField({ tableId, fieldId });
      await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
    });

    test('should convert longText to checkbox', async () => {
      const fieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'longText', id: fieldId, name: 'LT to Check' },
      });
      const r1 = await ctx.createRecord(tableId, { [fieldId]: 'true' });
      const r2 = await ctx.createRecord(tableId, { [fieldId]: 'false' });
      const r3 = await ctx.createRecord(tableId, { [fieldId]: 'yes' });
      const r4 = await ctx.createRecord(tableId, { [fieldId]: 'random\ntext' });

      await ctx.updateField({
        tableId,
        fieldId,
        field: { type: 'checkbox' },
      });

      const records = await ctx.listRecordsWithoutDrain(tableId);
      expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe(true);
      expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe(true);
      expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBe(true);
      expect(records.find((r) => r.id === r4.id)?.fields[fieldId]).toBe(true);

      await ctx.deleteField({ tableId, fieldId });
      await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id, r4.id]);
    });

    test('should convert longText to date', async () => {
      const fieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'longText', id: fieldId, name: 'LT to Date' },
      });
      const r1 = await ctx.createRecord(tableId, { [fieldId]: '2024-01-15' });
      const r2 = await ctx.createRecord(tableId, { [fieldId]: 'not a date' });

      await ctx.updateField({
        tableId,
        fieldId,
        field: { type: 'date' },
      });

      const records = await ctx.listRecordsWithoutDrain(tableId);
      expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toMatch(/^2024-01-15/);
      expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBeNull();

      await ctx.deleteField({ tableId, fieldId });
      await ctx.deleteRecords(tableId, [r1.id, r2.id]);
    });
  });
});
