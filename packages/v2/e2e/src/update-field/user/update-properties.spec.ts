/* eslint-disable @typescript-eslint/naming-convention */
import type { IFieldDto } from '@teable/v2-contract-http';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

type UserCellValue = { id: string; title?: string };

type UserFieldDto = IFieldDto & {
  type: 'user';
  options?: {
    isMultiple?: boolean;
    shouldNotify?: boolean;
    defaultValue?: string | string[];
  };
};

const isUserField = (field: IFieldDto): field is UserFieldDto => field.type === 'user';

describe('update-field: user property updates', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createUserField = async (
    name: string,
    options?: { isMultiple?: boolean; shouldNotify?: boolean; defaultValue?: string | string[] }
  ) => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'user',
        id: fieldId,
        name,
        ...(options ? { options } : {}),
      },
    });
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'User Property Updates',
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

  test('should convert single user to multiple users', async () => {
    const fieldId = await createUserField('Single User', {
      isMultiple: false,
      shouldNotify: false,
    });
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: { id: 'system', title: 'System' },
    });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'Null User' });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'user', options: { isMultiple: true, shouldNotify: false } },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField).toBeDefined();
    expect(isUserField(updatedField!)).toBe(true);
    if (isUserField(updatedField!)) {
      expect(updatedField.options?.isMultiple).toBe(true);
    }

    const records = await ctx.listRecordsWithoutDrain(tableId);
    const v1 = records.find((r) => r.id === r1.id)?.fields[fieldId] as
      | UserCellValue[]
      | null
      | undefined;
    const v2 = records.find((r) => r.id === r2.id)?.fields[fieldId];

    expect(Array.isArray(v1)).toBe(true);
    expect(v1?.[0]).toMatchObject({ id: 'system' });
    expect(v2).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should convert multiple users to single user', async () => {
    const fieldId = await createUserField('Multiple User', {
      isMultiple: true,
      shouldNotify: false,
    });
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: [
        { id: 'system', title: 'System' },
        { id: ctx.testUser.id, title: ctx.testUser.name },
      ],
    });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'user', options: { isMultiple: false, shouldNotify: false } },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField).toBeDefined();
    expect(isUserField(updatedField!)).toBe(true);
    if (isUserField(updatedField!)) {
      expect(updatedField.options?.isMultiple).toBe(false);
    }

    const records = await ctx.listRecordsWithoutDrain(tableId);
    const value = records.find((r) => r.id === r1.id)?.fields[fieldId] as
      | UserCellValue
      | null
      | undefined;
    expect(Array.isArray(value)).toBe(false);
    expect(value).toMatchObject({ id: 'system' });

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should handle empty array when converting to single', async () => {
    const fieldId = await createUserField('Empty Array User', {
      isMultiple: true,
      shouldNotify: false,
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: [] });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'user', options: { isMultiple: false, shouldNotify: false } },
    });

    const records = await ctx.listRecordsWithoutDrain(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toEqual([]);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should update notification settings', async () => {
    const fieldId = await createUserField('Notify User', {
      isMultiple: false,
      shouldNotify: false,
    });
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: { id: 'system', title: 'System' },
    });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'user', options: { isMultiple: false, shouldNotify: true } },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField).toBeDefined();
    expect(isUserField(updatedField!)).toBe(true);
    if (isUserField(updatedField!)) {
      expect(updatedField.options?.shouldNotify).toBe(true);
      expect(updatedField.options?.isMultiple).toBe(false);
    }

    const records = await ctx.listRecordsWithoutDrain(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toMatchObject({ id: 'system' });

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should set defaultValue to current user', async () => {
    const fieldId = await createUserField('Default Current User', {
      isMultiple: false,
      shouldNotify: false,
    });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: {
        type: 'user',
        options: { isMultiple: false, shouldNotify: false, defaultValue: 'me' },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField).toBeDefined();
    expect(isUserField(updatedField!)).toBe(true);
    if (isUserField(updatedField!)) {
      expect(updatedField.options?.defaultValue).toBe('me');
    }

    await ctx.deleteField({ tableId, fieldId });
  });

  test('should set defaultValue to specific users', async () => {
    const fieldId = await createUserField('Default Specific Users', {
      isMultiple: true,
      shouldNotify: false,
    });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: {
        type: 'user',
        options: { isMultiple: true, shouldNotify: false, defaultValue: ['me', ctx.testUser.id] },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField).toBeDefined();
    expect(isUserField(updatedField!)).toBe(true);
    if (isUserField(updatedField!)) {
      expect(updatedField.options?.defaultValue).toEqual(['me', ctx.testUser.id]);
      expect(updatedField.options?.isMultiple).toBe(true);
    }

    await ctx.deleteField({ tableId, fieldId });
  });
});

describe('update-field: user conversions', () => {
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
      name: 'User Field Conversions',
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

  test('should convert user to text', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'user',
        id: fieldId,
        name: 'User Field',
      },
    });
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: { id: 'system', title: 'System' },
    });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const records = await ctx.listRecordsWithoutDrain(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe('System');

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should convert text to user', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleLineText',
        id: fieldId,
        name: 'Text Field',
      },
    });
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: 'random text value',
    });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'user' },
    });

    const records = await ctx.listRecordsWithoutDrain(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBeNull();
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should NOT convert user to number', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'user',
        id: fieldId,
        name: 'User to Number',
      },
    });
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: { id: 'system', title: 'System' },
    });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'number' },
    });

    const records = await ctx.listRecordsWithoutDrain(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });
});
