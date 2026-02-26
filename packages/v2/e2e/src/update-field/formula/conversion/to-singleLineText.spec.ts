/**
 * E2E tests for converting Formula field to SingleLineText.
 * Aligned with v1 field-converting.e2e-spec.ts "should convert formula to text".
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: formula → singleLineText conversion', () => {
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
      name: 'Formula to SingleLineText Conversion',
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

  test('should convert datetime formula to text with formatted value (v1 align)', async () => {
    // 1. Create a date field with 24hr format, LA timezone
    const dateFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'date',
        id: dateFieldId,
        name: 'DateTime Source',
        options: {
          formatting: {
            date: 'YYYY-MM-DD',
            time: 'HH:mm',
            timeZone: 'America/Los_Angeles',
          },
        },
      },
    });

    // 2. Create a formula field referencing the date field with 12hr format
    const formulaFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        id: formulaFieldId,
        name: 'Formula DateTime',
        options: {
          expression: `{${dateFieldId}}`,
          formatting: {
            date: 'YYYY-MM-DD',
            time: 'hh:mm A',
            timeZone: 'America/Los_Angeles',
          },
        },
      },
    });

    // 3. Create a record with date '2024-02-28 16:00' PST = '2024-02-29T00:00:00.000Z' UTC
    const rec = await ctx.createRecord(tableId, { [dateFieldId]: '2024-02-28 16:00' });

    // 4. Verify formula raw value is the UTC timestamp
    const records = await ctx.listRecords(tableId);
    const recData = records.find((r) => r.id === rec.id);
    expect(recData?.fields[formulaFieldId]).toBe('2024-02-29T00:00:00.000Z');

    // 5. Convert formula field to singleLineText
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId: formulaFieldId,
      field: { type: 'singleLineText' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === formulaFieldId);
    expect(updatedField?.type).toBe('singleLineText');

    // 6. The text value should be the formatted datetime: '2024-02-28 04:00 PM'
    const afterRecords = await ctx.listRecords(tableId);
    const afterRec = afterRecords.find((r) => r.id === rec.id);
    expect(afterRec?.fields[formulaFieldId]).toBe('2024-02-28 04:00 PM');

    await ctx.deleteField({ tableId, fieldId: formulaFieldId });
    await ctx.deleteField({ tableId, fieldId: dateFieldId });
    await ctx.deleteRecords(tableId, [rec.id]);
  });

  test('should convert number formula to text', async () => {
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
        name: 'Formula Num',
        options: { expression: `{${numFieldId}}` },
      },
    });

    const rec = await ctx.createRecord(tableId, { [numFieldId]: 42 });
    await ctx.drainOutbox();

    await ctx.updateField({
      tableId,
      fieldId: formulaFieldId,
      field: { type: 'singleLineText' },
    });

    const afterRecords = await ctx.listRecords(tableId);
    const afterRec = afterRecords.find((r) => r.id === rec.id);
    expect(afterRec?.fields[formulaFieldId]).toBe('42');

    await ctx.deleteField({ tableId, fieldId: formulaFieldId });
    await ctx.deleteField({ tableId, fieldId: numFieldId });
    await ctx.deleteRecords(tableId, [rec.id]);
  });

  test('should convert string formula to text', async () => {
    const textFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: textFieldId, name: 'Text Source' },
    });

    const formulaFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        id: formulaFieldId,
        name: 'Formula Str',
        options: { expression: `{${textFieldId}}` },
      },
    });

    const rec = await ctx.createRecord(tableId, { [textFieldId]: 'hello world' });
    await ctx.drainOutbox();

    await ctx.updateField({
      tableId,
      fieldId: formulaFieldId,
      field: { type: 'singleLineText' },
    });

    const afterRecords = await ctx.listRecords(tableId);
    const afterRec = afterRecords.find((r) => r.id === rec.id);
    expect(afterRec?.fields[formulaFieldId]).toBe('hello world');

    await ctx.deleteField({ tableId, fieldId: formulaFieldId });
    await ctx.deleteField({ tableId, fieldId: textFieldId });
    await ctx.deleteRecords(tableId, [rec.id]);
  });

  test('should handle null values', async () => {
    const numFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', id: numFieldId, name: 'Null Num' },
    });

    const formulaFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        id: formulaFieldId,
        name: 'Formula NullCheck',
        options: { expression: `{${numFieldId}}` },
      },
    });

    const r1 = await ctx.createRecord(tableId, { [numFieldId]: 99 });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'empty' });
    await ctx.drainOutbox();

    await ctx.updateField({
      tableId,
      fieldId: formulaFieldId,
      field: { type: 'singleLineText' },
    });

    const afterRecords = await ctx.listRecords(tableId);
    const rec1 = afterRecords.find((r) => r.id === r1.id);
    const rec2 = afterRecords.find((r) => r.id === r2.id);
    expect(rec1?.fields[formulaFieldId]).toBe('99');
    expect(rec2?.fields[formulaFieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId: formulaFieldId });
    await ctx.deleteField({ tableId, fieldId: numFieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });
});
