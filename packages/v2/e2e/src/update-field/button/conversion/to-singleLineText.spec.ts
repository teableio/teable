/**
 * E2E tests for converting button field to singleLineText.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: button → singleLineText conversion', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createButtonField = async (name: string) => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'button',
        id: fieldId,
        name,
        options: { label: 'Run', color: 'teal', maxCount: null, resetCount: false },
      },
    });
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Button to singleLineText Conversion',
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

  test('should drop the click count when converting a button to text', async () => {
    const fieldId = await createButtonField('Button Field');
    // A clicked button persists its click count as {"count": 2} in the jsonb cell.
    const r1 = await ctx.createRecord(tableId, { [fieldId]: { count: 2 } });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('singleLineText');

    const records = await ctx.listRecords(tableId);
    // v1 parity: ButtonFieldCore.cellValue2String always returns '' so the converted text is empty.
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should handle null and zero-count records', async () => {
    const fieldId = await createButtonField('Null Button Field');
    const r1 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: { count: 0 } });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBeNull();
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });
});
