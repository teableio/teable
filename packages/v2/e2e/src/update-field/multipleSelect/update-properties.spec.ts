import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

const Colors = {
  CyanBright: 'cyanBright',
  BlueBright: 'blueBright',
  GreenBright: 'greenBright',
  YellowBright: 'yellowBright',
  RedBright: 'redBright',
} as const;

type SelectFieldOptions = {
  choices?: Array<{ id?: string; name: string; color?: string }>;
  preventAutoNewOptions?: boolean;
  defaultValue?: string[];
};

let fieldIdCounter = 0;
const createFieldId = () => {
  const suffix = fieldIdCounter.toString(36).padStart(16, '0');
  fieldIdCounter += 1;
  return `fld${suffix}`;
};

const getSelectOptions = (field?: { options?: unknown }): SelectFieldOptions =>
  (field?.options as SelectFieldOptions | undefined) ?? {};

describe('update-field: multipleSelect property updates', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'MultipleSelect Update Properties',
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
        // Ignore cleanup errors
      }
    }
  });

  // ============ Options management (array-specific) ============

  test('should change choices for multiple select (rename + delete)', async () => {
    const fieldId = createFieldId();
    const optionX = { id: 'choX', name: 'x', color: Colors.CyanBright };
    const optionY = { id: 'choY', name: 'y', color: Colors.BlueBright };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'ChangeChoices',
        options: { choices: [optionX, optionY] },
      },
    });

    const r1 = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'Row 1',
      [fieldId]: ['x'],
    });
    const r2 = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'Row 2',
      [fieldId]: ['x', 'y'],
    });
    const r3 = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'Row 3',
      [fieldId]: ['y'],
    });

    // Action: Rename x→xx, remove y
    const optionXX = { id: 'choX', name: 'xx', color: Colors.CyanBright };
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { choices: [optionXX] } },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.options).toMatchObject({
      choices: [{ name: 'xx', color: Colors.CyanBright }],
    });

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    const rec3 = records.find((r) => r.id === r3.id);
    expect(rec1?.fields[fieldId]).toEqual(['xx']);
    expect(rec2?.fields[fieldId]).toEqual(['xx']);
    expect(rec3?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should nullify cell when deleting option results in empty array', async () => {
    const fieldId = createFieldId();
    const optionA = { id: 'choA', name: 'A', color: Colors.BlueBright };
    const optionB = { id: 'choB', name: 'B', color: Colors.GreenBright };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'EmptyArray',
        options: { choices: [optionA, optionB] },
      },
    });

    const r1 = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'Row 1',
      [fieldId]: ['A'],
    });
    const r2 = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'Row 2',
      [fieldId]: ['B'],
    });
    const r3 = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'Row 3',
      [fieldId]: ['A', 'B'],
    });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { choices: [optionB] } },
    });

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    const rec3 = records.find((r) => r.id === r3.id);
    expect(rec1?.fields[fieldId]).toBeNull();
    expect(rec2?.fields[fieldId]).toEqual(['B']);
    expect(rec3?.fields[fieldId]).toEqual(['B']);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should delete multiple options at once', async () => {
    const fieldId = createFieldId();
    const optionA = { id: 'choA', name: 'A', color: Colors.BlueBright };
    const optionB = { id: 'choB', name: 'B', color: Colors.GreenBright };
    const optionC = { id: 'choC', name: 'C', color: Colors.YellowBright };
    const optionD = { id: 'choD', name: 'D', color: Colors.RedBright };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'DeleteMultiple',
        options: { choices: [optionA, optionB, optionC, optionD] },
      },
    });

    const r1 = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'Row 1',
      [fieldId]: ['A', 'B', 'C', 'D'],
    });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { choices: [optionA, optionD] } },
    });

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    expect(rec1?.fields[fieldId]).toEqual(['A', 'D']);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  // ============ AutoNewOptions ============

  test('should enable autoNewOptions', async () => {
    const fieldId = createFieldId();
    const redOption = { id: 'choRed', name: 'Red', color: Colors.RedBright };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Auto Options',
        options: { choices: [redOption], preventAutoNewOptions: true },
      },
    });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { preventAutoNewOptions: false } },
    });

    const updatedField = (await ctx.getTableById(tableId)).fields.find((f) => f.id === fieldId);
    expect(getSelectOptions(updatedField).preventAutoNewOptions).toBeFalsy();

    await ctx.deleteField({ tableId, fieldId });
  });

  // ============ DefaultValue ============

  test('should set array defaultValue', async () => {
    const fieldId = createFieldId();
    const optionA = { id: 'choA', name: 'A', color: Colors.BlueBright };
    const optionB = { id: 'choB', name: 'B', color: Colors.GreenBright };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Default Tags',
        options: { choices: [optionA, optionB] },
      },
    });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { defaultValue: ['A', 'B'] } },
    });

    const updatedField = (await ctx.getTableById(tableId)).fields.find((f) => f.id === fieldId);
    expect(getSelectOptions(updatedField).defaultValue).toEqual(['A', 'B']);

    await ctx.deleteField({ tableId, fieldId });
  });

  test('should validate all defaultValue items exist in options', async () => {
    const fieldId = createFieldId();
    const optionA = { id: 'choA', name: 'A', color: Colors.BlueBright };
    const optionB = { id: 'choB', name: 'B', color: Colors.GreenBright };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Invalid Default',
        options: { choices: [optionA, optionB] },
      },
    });

    await expect(
      ctx.updateField({
        tableId,
        fieldId,
        field: { options: { defaultValue: ['A', 'X'] } },
      })
    ).rejects.toThrow();

    await ctx.deleteField({ tableId, fieldId });
  });
});

describe('update-field: multipleSelect conversions', () => {
  let ctx: SharedTestContext;
  let tableId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'MultipleSelect Conversions',
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

  test('should convert multipleSelect to singleSelect', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'MtoS',
        options: {
          choices: [
            { id: 'choA', name: 'A', color: Colors.BlueBright },
            { id: 'choB', name: 'B', color: Colors.GreenBright },
          ],
        },
      },
    });

    const r1 = await ctx.createRecord(tableId, { [fieldId]: ['A', 'B'] });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: ['B'] });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: null });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleSelect' },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe('A');
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe('B');
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
  });

  test('should convert multipleSelect to text', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'MtoT',
        options: {
          choices: [
            { id: 'choA', name: 'A', color: Colors.BlueBright },
            { id: 'choB', name: 'B', color: Colors.GreenBright },
          ],
        },
      },
    });

    const r1 = await ctx.createRecord(tableId, { [fieldId]: ['A', 'B'] });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe('A, B');

    await ctx.deleteField({ tableId, fieldId });
  });

  test('should convert multipleSelect to checkbox', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'MtoC',
        options: { choices: [{ id: 'choA', name: 'A', color: Colors.BlueBright }] },
      },
    });

    const r1 = await ctx.createRecord(tableId, { [fieldId]: ['A'] });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: null });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'checkbox' },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe(true);
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
  });

  test('should NOT convert multipleSelect to number', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'MtoN',
        options: { choices: [{ id: 'choA', name: 'A', color: Colors.BlueBright }] },
      },
    });

    await ctx.createRecord(tableId, { [fieldId]: ['A'] });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'number' },
    });

    const records = await ctx.listRecords(tableId);
    records.forEach((r) => {
      if (r.fields[fieldId] !== undefined) {
        expect(r.fields[fieldId]).toBeNull();
      }
    });

    await ctx.deleteField({ tableId, fieldId });
  });
});
