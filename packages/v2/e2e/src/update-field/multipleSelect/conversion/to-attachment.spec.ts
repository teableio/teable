/**
 * E2E tests for converting multipleSelect field to Attachment.
 *
 * Conversion behavior:
 * - Same DB type (jsonb) but incompatible -> values nullified
 * - Null values remain null
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: multipleSelect → attachment conversion', () => {
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
      name: 'MultipleSelect to Attachment Conversion',
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

  test('should clear data (incompatible types)', async () => {
    // Setup: Create multipleSelect with values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Multi Attachment Field',
        options: {
          choices: [
            { id: 'cho1', name: 'Red', color: 'redBright' },
            { id: 'cho2', name: 'Blue', color: 'blueBright' },
          ],
        },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: ['Red', 'Blue'] });

    // Action: Convert to attachment
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'attachment' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('attachment');

    // Assert: Values become null (data cannot represent an attachment)
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    expect(rec1?.fields[fieldId]).toBeNull();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should handle already null values', async () => {
    // Setup: Create multipleSelect with null values
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Null Multi Attachment',
        options: {
          choices: [{ id: 'cho1', name: 'Red', color: 'redBright' }],
        },
      },
    });
    const r1 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' });

    // Action: Convert to attachment
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'attachment' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('attachment');

    // Assert: null remains null
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    expect(rec1?.fields[fieldId]).toBeNull();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });
});
