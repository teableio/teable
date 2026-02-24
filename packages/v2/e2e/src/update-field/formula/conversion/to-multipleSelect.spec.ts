/**
 * E2E tests for converting Formula field to MultipleSelect.
 * Aligned with v1: value formatted as text becomes the select option in array.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: formula → multipleSelect conversion', () => {
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
      name: 'Formula to MultipleSelect Conversion',
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

  test('should convert number formula to multipleSelect wrapped in array', async () => {
    const numFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', id: numFieldId, name: 'Num Source' },
    });

    const formulaFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        id: formulaFieldId,
        name: 'Formula Msel',
        options: { expression: `{${numFieldId}}` },
      },
    });

    const r1 = await ctx.createRecord(tableId, { [numFieldId]: 42 });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'empty' });
    await ctx.drainOutbox();

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId: formulaFieldId,
      field: { type: 'multipleSelect' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === formulaFieldId);
    expect(updatedField?.type).toBe('multipleSelect');

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[formulaFieldId]).toEqual(['42']);
    expect(rec2?.fields[formulaFieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId: formulaFieldId });
    await ctx.deleteField({ tableId, fieldId: numFieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });
});
