/**
 * E2E tests for converting SingleLineText field to User.
 *
 * Conversion behavior:
 * - Text values matching user email or name are converted to user JSONB
 * - Text values not matching any user become null
 * - Null values remain null
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: singleLineText → user conversion', () => {
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
      name: 'SingleLineText to User Conversion',
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

  test('should convert text values to null (incompatible - no matching user)', async () => {
    // Setup: Create singleLineText with text values that won't match any user
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Text Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'random text value' });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 'another random value' });

    // Action: Convert to user
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'user' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('user');

    // Assert: Text values become null (cannot convert text to user reference without matching user)
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    expect(rec1?.fields[fieldId]).toBeNull();
    expect(rec2?.fields[fieldId]).toBeNull();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should handle null values', async () => {
    // Setup: Create singleLineText with null
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Null Field' },
    });
    const r1 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' }); // null for fieldId

    // Action: Convert to user
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'user' },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('user');

    // Assert: null remains null
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    expect(rec1?.fields[fieldId]).toBeNull();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });
});
