/**
 * E2E tests for updating Select field properties (SingleSelect and MultipleSelect).
 *
 * V1 Behavior Reference:
 * - modifySelectOptions(): Renames/deletes choices and updates record values
 * - When a choice is renamed, all record values using that choice are updated
 * - When a choice is deleted, record values using that choice become null
 */
import { createRecordOkResponseSchema } from '@teable/v2-contract-http';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

type SelectOptionsDto = {
  choices?: Array<{ id: string; name: string; color: string }>;
  defaultValue?: string | string[];
  preventAutoNewOptions?: boolean;
};

const getSelectOptions = (field?: { options?: unknown }) =>
  (field?.options as SelectOptionsDto | undefined) ?? {};

const getSelectChoices = (field?: { options?: unknown }) => getSelectOptions(field).choices ?? [];

let fieldIdCounter = 0;
const createFieldId = () => {
  const suffix = fieldIdCounter.toString(36).padStart(16, '0');
  fieldIdCounter += 1;
  return `fld${suffix}`;
};

describe('update-field: singleSelect property updates', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'SingleSelect Update Properties',
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

  // ============ Options management ============

  test('should add new option', async () => {
    // Setup: Create singleSelect with options: ["Red", "Green"]
    const fieldId = createFieldId();
    const redOption = { id: 'choRed', name: 'Red', color: 'redBright' };
    const greenOption = { id: 'choGreen', name: 'Green', color: 'greenBright' };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Color',
        options: { choices: [redOption, greenOption] },
      },
    });

    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Red' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'Green' });

    // Action: Update options to ["Red", "Green", "Blue"]
    const blueOption = { id: 'choBlue', name: 'Blue', color: 'blueBright' };
    const updatedTable = await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: { options: { choices: [redOption, greenOption, blueOption] } },
    });

    // Assert: New "Blue" option added
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    const choices = getSelectChoices(updatedField);
    expect(choices.map((choice) => choice.name)).toEqual(['Red', 'Green', 'Blue']);

    // Assert: Existing record values preserved
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBe('Red');
    expect(rec2?.fields[fieldId]).toBe('Green');

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should accept choices without color and auto-fill colors on update', async () => {
    const fieldId = createFieldId();
    const redOption = { id: 'choNoColorRed', name: 'Red', color: 'redBright' };
    const greenOption = { id: 'choNoColorGreen', name: 'Green', color: 'greenBright' };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Color No Color Update',
        options: { choices: [redOption, greenOption] },
      },
    });

    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Red' });

    const updatedTable = await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: {
        options: {
          choices: [
            { id: redOption.id, name: 'Crimson' },
            { id: greenOption.id, name: 'Green' },
          ],
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    const choices = getSelectChoices(updatedField);
    expect(choices.map((choice) => choice.name)).toEqual(['Crimson', 'Green']);
    expect(choices.every((choice) => !!choice.color)).toBe(true);

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    expect(rec1?.fields[fieldId]).toBe('Crimson');

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should rename option and update record values', async () => {
    // Setup: Create singleSelect with options: [{id: "cho1", name: "Red"}]
    const fieldId = createFieldId();
    const redOption = { id: 'choRed', name: 'Red', color: 'redBright' };
    const greenOption = { id: 'choGreen', name: 'Green', color: 'greenBright' };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Color',
        options: { choices: [redOption, greenOption] },
      },
    });

    // Create records with value "Red"
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Red' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'Green' });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 'Red' });

    // Action: Update options, change "Red" to "Crimson" (same id)
    const crimsonOption = { ...redOption, name: 'Crimson' };
    const updatedTable = await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: { options: { choices: [crimsonOption, greenOption] } },
    });

    // Assert: Option renamed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    const choices = getSelectChoices(updatedField);
    expect(choices.some((choice) => choice.name === 'Crimson')).toBe(true);
    expect(choices.some((choice) => choice.name === 'Red')).toBe(false);

    // Assert: All record values updated from "Red" to "Crimson"
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    const rec3 = records.find((r) => r.id === r3.id);
    expect(rec1?.fields[fieldId]).toBe('Crimson');
    expect(rec2?.fields[fieldId]).toBe('Green');
    expect(rec3?.fields[fieldId]).toBe('Crimson');

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should delete unused option', async () => {
    // Setup: Create singleSelect with options: ["Red", "Green"], no records use "Green"
    const fieldId = createFieldId();
    const redOption = { id: 'choRed', name: 'Red', color: 'redBright' };
    const greenOption = { id: 'choGreen', name: 'Green', color: 'greenBright' };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Color',
        options: { choices: [redOption, greenOption] },
      },
    });

    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Red' });

    // Action: Update options to ["Red"]
    const updatedTable = await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: { options: { choices: [redOption] } },
    });

    // Assert: "Green" option removed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    const choices = getSelectChoices(updatedField);
    expect(choices.map((choice) => choice.name)).toEqual(['Red']);

    // Assert: Record values preserved
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    expect(rec1?.fields[fieldId]).toBe('Red');

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should delete used option and nullify record values', async () => {
    // Setup: Create singleSelect with options: ["Red", "Green"]
    const fieldId = createFieldId();
    const redOption = { id: 'choRed', name: 'Red', color: 'redBright' };
    const greenOption = { id: 'choGreen', name: 'Green', color: 'greenBright' };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Color',
        options: { choices: [redOption, greenOption] },
      },
    });

    // Create records: "Red", "Green", "Red"
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Red' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'Green' });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 'Red' });

    // Action: Update options to ["Red"] (remove "Green")
    const updatedTable = await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: { options: { choices: [redOption] } },
    });

    // Assert: "Green" option removed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    const choices = getSelectChoices(updatedField);
    expect(choices.map((choice) => choice.name)).toEqual(['Red']);

    // Assert: Records with "Green" become null
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    const rec3 = records.find((r) => r.id === r3.id);
    expect(rec1?.fields[fieldId]).toBe('Red');
    expect(rec2?.fields[fieldId]).toBeNull();
    expect(rec3?.fields[fieldId]).toBe('Red');

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should update option color', async () => {
    // Setup: Create singleSelect with options: [{name: "Red", color: "redBright"}]
    const fieldId = createFieldId();
    const redOption = { id: 'choRed', name: 'Red', color: 'redBright' };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Color',
        options: { choices: [redOption] },
      },
    });

    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'Red' });

    // Action: Update option color to "blueBright"
    const updatedTable = await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: {
        options: {
          choices: [{ ...redOption, color: 'blueBright' }],
        },
      },
    });

    // Assert: Option color changed, records unaffected
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    const choices = getSelectChoices(updatedField);
    expect(choices.find((choice) => choice.name === 'Red')?.color).toBe('blueBright');

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    expect(rec1?.fields[fieldId]).toBe('Red');

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should reorder options', async () => {
    // Setup: Create singleSelect with options: ["A", "B", "C"]
    const fieldId = createFieldId();
    const optionA = { id: 'choA', name: 'A', color: 'blueBright' };
    const optionB = { id: 'choB', name: 'B', color: 'greenBright' };
    const optionC = { id: 'choC', name: 'C', color: 'yellowBright' };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Order',
        options: { choices: [optionA, optionB, optionC] },
      },
    });

    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'B' });

    // Action: Update options order to ["C", "A", "B"]
    const updatedTable = await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: { options: { choices: [optionC, optionA, optionB] } },
    });

    // Assert: Order changed, records unaffected
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    const choices = getSelectChoices(updatedField);
    expect(choices.map((choice) => choice.name)).toEqual(['C', 'A', 'B']);

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    expect(rec1?.fields[fieldId]).toBe('B');

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  // ============ AutoNewOptions ============

  test('should enable autoNewOptions', async () => {
    // Setup: Create singleSelect with autoNewOptions: false
    const fieldId = createFieldId();
    const redOption = { id: 'choRed', name: 'Red', color: 'redBright' };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Auto Options',
        options: { choices: [redOption], preventAutoNewOptions: true },
      },
    });

    // Action: Update autoNewOptions to true (preventAutoNewOptions: false)
    const updatedTable = await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: { options: { preventAutoNewOptions: false } },
    });

    // Assert: Field updated
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    const options = getSelectOptions(updatedField);
    expect(options.preventAutoNewOptions).toBeUndefined();

    // Assert: New values can now auto-create options
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        typecast: true,
        fields: {
          [primaryFieldId]: 'Auto Create',
          [fieldId]: 'Blue',
        },
      }),
    });

    expect(response.status).toBe(201);
    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) throw new Error('Failed to parse create record');
    const recordId = parsed.data.data.record.id;

    const records = await ctx.listRecords(tableId);
    const record = records.find((r) => r.id === recordId);
    expect(record?.fields[fieldId]).toBe('Blue');

    const refreshedTable = await ctx.getTableById(tableId);
    const refreshedField = refreshedTable.fields.find((f) => f.id === fieldId);
    const refreshedChoices = getSelectChoices(refreshedField);
    expect(refreshedChoices.some((choice) => choice.name === 'Blue')).toBe(true);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecord(tableId, recordId);
  });

  // ============ DefaultValue ============

  test('should set defaultValue to existing option', async () => {
    // Setup: Create singleSelect with options: ["A", "B"]
    const fieldId = createFieldId();
    const optionA = { id: 'choA', name: 'A', color: 'blueBright' };
    const optionB = { id: 'choB', name: 'B', color: 'greenBright' };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Default',
        options: { choices: [optionA, optionB] },
      },
    });

    // Action: Update defaultValue to "A"
    const updatedTable = await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: { options: { defaultValue: 'A' } },
    });

    // Assert: Default set
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    const options = getSelectOptions(updatedField);
    expect(options.defaultValue).toBe('A');

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
  });

  test('should reject defaultValue not in options', async () => {
    // Setup: Create singleSelect with options: ["A", "B"]
    const fieldId = createFieldId();
    const optionA = { id: 'choA', name: 'A', color: 'blueBright' };
    const optionB = { id: 'choB', name: 'B', color: 'greenBright' };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Invalid Default',
        options: { choices: [optionA, optionB] },
      },
    });

    // Action: Update defaultValue to "C"
    await expect(
      ctx.updateField({
        baseId: ctx.baseId,
        tableId,
        fieldId,
        field: { options: { defaultValue: 'C' } },
      })
    ).rejects.toThrow();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
  });

  test('should reject deleting option used as defaultValue', async () => {
    // Setup: Create singleSelect with options: ["A", "B"], defaultValue: "B"
    const fieldId = createFieldId();
    const optionA = { id: 'choA', name: 'A', color: 'blueBright' };
    const optionB = { id: 'choB', name: 'B', color: 'greenBright' };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Default Delete',
        options: { choices: [optionA, optionB], defaultValue: 'B' },
      },
    });

    // Action: Update options to ["A"]
    await expect(
      ctx.updateField({
        baseId: ctx.baseId,
        tableId,
        fieldId,
        field: { options: { choices: [optionA] } },
      })
    ).rejects.toThrow();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
  });
});

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

  test('should add new option', async () => {
    // Setup: Create multipleSelect with options: ["A", "B"]
    const fieldId = createFieldId();
    const optionA = { id: 'choA', name: 'A', color: 'blueBright' };
    const optionB = { id: 'choB', name: 'B', color: 'greenBright' };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Tags',
        options: { choices: [optionA, optionB] },
      },
    });

    // Action: Update options to ["A", "B", "C"]
    const optionC = { id: 'choC', name: 'C', color: 'yellowBright' };
    const updatedTable = await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: { options: { choices: [optionA, optionB, optionC] } },
    });

    // Assert: New option added
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    const choices = getSelectChoices(updatedField);
    expect(choices.map((choice) => choice.name)).toEqual(['A', 'B', 'C']);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
  });

  test('should preserve array values when updating options', async () => {
    // Setup: Create multipleSelect, records with: ["A", "B"], ["B", "C"]
    const fieldId = createFieldId();
    const optionA = { id: 'choA', name: 'A', color: 'blueBright' };
    const optionB = { id: 'choB', name: 'B', color: 'greenBright' };
    const optionC = { id: 'choC', name: 'C', color: 'yellowBright' };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Tags',
        options: { choices: [optionA, optionB, optionC] },
      },
    });

    const r1 = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'Row 1',
      [fieldId]: ['A', 'B'],
    });
    const r2 = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'Row 2',
      [fieldId]: ['B', 'C'],
    });

    // Action: Add option "D"
    const optionD = { id: 'choD', name: 'D', color: 'redBright' };
    await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: { options: { choices: [optionA, optionB, optionC, optionD] } },
    });

    // Assert: Existing array values preserved
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toEqual(['A', 'B']);
    expect(rec2?.fields[fieldId]).toEqual(['B', 'C']);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should remove deleted option from array values', async () => {
    // Setup: Create multipleSelect, record with: ["A", "B", "C"]
    const fieldId = createFieldId();
    const optionA = { id: 'choA', name: 'A', color: 'blueBright' };
    const optionB = { id: 'choB', name: 'B', color: 'greenBright' };
    const optionC = { id: 'choC', name: 'C', color: 'yellowBright' };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Tags',
        options: { choices: [optionA, optionB, optionC] },
      },
    });

    const r1 = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'Row 1',
      [fieldId]: ['A', 'B', 'C'],
    });

    // Action: Remove option "B"
    await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: { options: { choices: [optionA, optionC] } },
    });

    // Assert: Record value becomes ["A", "C"]
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    expect(rec1?.fields[fieldId]).toEqual(['A', 'C']);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should rename option in array values', async () => {
    // Setup: Create multipleSelect, record with: ["A", "B"]
    const fieldId = createFieldId();
    const optionA = { id: 'choA', name: 'A', color: 'blueBright' };
    const optionB = { id: 'choB', name: 'B', color: 'greenBright' };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Tags',
        options: { choices: [optionA, optionB] },
      },
    });

    const r1 = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'Row 1',
      [fieldId]: ['A', 'B'],
    });

    // Action: Rename "B" to "Beta"
    const optionBeta = { ...optionB, name: 'Beta' };
    await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: { options: { choices: [optionA, optionBeta] } },
    });

    // Assert: Record value becomes ["A", "Beta"]
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    expect(rec1?.fields[fieldId]).toEqual(['A', 'Beta']);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should set array defaultValue', async () => {
    // Setup: Create multipleSelect with options: ["A", "B", "C"]
    const fieldId = createFieldId();
    const optionA = { id: 'choA', name: 'A', color: 'blueBright' };
    const optionB = { id: 'choB', name: 'B', color: 'greenBright' };
    const optionC = { id: 'choC', name: 'C', color: 'yellowBright' };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Default Tags',
        options: { choices: [optionA, optionB, optionC] },
      },
    });

    // Action: Update defaultValue to ["A", "B"]
    const updatedTable = await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: { options: { defaultValue: ['A', 'B'] } },
    });

    // Assert: Default set to array
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    const options = getSelectOptions(updatedField);
    expect(options.defaultValue).toEqual(['A', 'B']);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
  });
});
