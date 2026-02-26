/**
 * E2E tests for converting User field to Number.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: user → number conversion', () => {
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
      name: 'user to number conversion',
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

  test('should convert to null (not compatible)', async () => {
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
      field: { type: 'number' },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });
});
