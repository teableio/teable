/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: multipleSelect → singleLineText conversion', () => {
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
      name: 'MultipleSelect to SingleLineText Conversion',
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
        void 0;
      }
    }
  });

  test('should join array values with comma', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Multi Text Field',
        options: {
          choices: [
            { id: 'cho1', name: 'Red', color: 'redBright' },
            { id: 'cho2', name: 'Green', color: 'greenBright' },
            { id: 'cho3', name: 'Blue', color: 'blueBright' },
          ],
        },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: ['Red', 'Green', 'Blue'] });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('singleLineText');

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    expect(rec1?.fields[fieldId]).toBe('Red, Green, Blue');

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should handle single-item arrays', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Single-item Multi Field',
        options: {
          choices: [{ id: 'cho1', name: 'Red', color: 'redBright' }],
        },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: ['Red'] });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    expect(rec1?.fields[fieldId]).toBe('Red');

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should handle empty arrays', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Empty Multi Field',
        options: {
          choices: [{ id: 'cho1', name: 'Red', color: 'redBright' }],
        },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: [] });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('singleLineText');

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    expect(rec1?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should handle null values', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Null Multi Field',
        options: {
          choices: [{ id: 'cho1', name: 'Red', color: 'redBright' }],
        },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    expect(rec1?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });
});
