/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: formula → rating conversion', () => {
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
      name: 'Formula to Rating Conversion',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;
    const primaryField = table.fields.find((field) => field.isPrimary);
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

  test('should round, clamp, preserve null, and accept strict rewrites when converting to rating', async () => {
    const sourceFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', id: sourceFieldId, name: 'Source Value' },
    });

    const formulaFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        id: formulaFieldId,
        name: 'Calculated Value',
        options: { expression: `{${sourceFieldId}}` },
      },
    });

    const sourceValues = [2.7, 4.6, 0, -3, 9, 3, 0.4, null] as const;
    const expectedValues = [3, 5, null, null, 5, 3, null, null] as const;
    const records = [];

    for (const [index, value] of sourceValues.entries()) {
      records.push(
        await ctx.createRecord(
          tableId,
          value === null
            ? { [primaryFieldId]: `Case ${index + 1}` }
            : { [primaryFieldId]: `Case ${index + 1}`, [sourceFieldId]: value }
        )
      );
    }
    await ctx.drainOutbox();
    const computedRecords = await ctx.listRecords(tableId);
    for (const [index, record] of records.entries()) {
      expect(computedRecords.find((item) => item.id === record.id)?.fields[formulaFieldId]).toBe(
        sourceValues[index]
      );
    }

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId: formulaFieldId,
      field: { type: 'rating', max: 5 },
    });

    const updatedField = updatedTable.fields.find((field) => field.id === formulaFieldId);
    expect(updatedField?.type).toBe('rating');

    const convertedRecords = await ctx.listRecords(tableId);
    for (const [index, record] of records.entries()) {
      expect(convertedRecords.find((item) => item.id === record.id)?.fields[formulaFieldId]).toBe(
        expectedValues[index]
      );
    }

    for (const [index, record] of records.entries()) {
      const expectedValue = expectedValues[index];
      if (expectedValue === null) continue;

      const rewritten = await ctx.updateRecord(tableId, record.id, {
        [formulaFieldId]: expectedValue,
      });
      expect(rewritten.fields[formulaFieldId]).toBe(expectedValue);
    }

    await ctx.deleteRecords(
      tableId,
      records.map((record) => record.id)
    );
    await ctx.deleteField({ tableId, fieldId: formulaFieldId });
    await ctx.deleteField({ tableId, fieldId: sourceFieldId });
  });
});
