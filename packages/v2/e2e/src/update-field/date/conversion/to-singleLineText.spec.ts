/**
 * E2E tests for converting Date field to SingleLineText.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: date → singleLineText conversion', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createDateField = async (name: string) => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'date',
        id: fieldId,
        name,
        options: {
          formatting: {
            date: 'YYYY-MM-DD',
            time: 'HH:mm',
            timeZone: 'utc',
          },
        },
      },
    });
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Date to SingleLineText Conversion',
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

  test('should convert date to timestamp text', async () => {
    const fieldId = await createDateField('Date Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '2024-01-15T10:30:00.000Z' });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('singleLineText');

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const value = rec1?.fields[fieldId];
    expect(value).toEqual(expect.any(String));
    expect(value).toContain('2024-01-15');
    expect(value).toContain('10:30');

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should handle null values', async () => {
    const fieldId = await createDateField('Null Date Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '2024-01-15T10:30:00.000Z' });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('singleLineText');

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toEqual(expect.any(String));
    expect(rec2?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should keep timezone offset information in text output', async () => {
    const fieldId = await createDateField('TZ Field');
    const r1 = await ctx.createRecord(tableId, { [fieldId]: '2024-01-15T10:30:00.000Z' });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const value = rec1?.fields[fieldId];
    expect(value).toEqual(expect.any(String));
    expect(String(value)).toMatch(/[+-]\d{2}/);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });
});
