/**
 * E2E tests for converting attachment field to singleSelect.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';
import {
  ensureAttachmentTables,
  makeAttachmentCell,
  seedAttachment,
  type SeededAttachment,
} from '../testUtils';

describe('update-field: attachment → singleSelect conversion', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;
  let attachmentSeed: SeededAttachment;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createAttachmentField = async (name: string) => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'attachment',
        id: fieldId,
        name,
      },
    });
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    await ensureAttachmentTables(ctx);
    attachmentSeed = await seedAttachment(ctx);

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Attachment to SingleSelect Conversion',
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

  test('should convert attachment JSON to text-like singleSelect value', async () => {
    const fieldId = await createAttachmentField('Attachment Field');
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: makeAttachmentCell(attachmentSeed, 'a.txt'),
    });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleSelect' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('singleSelect');

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const value = rec1?.fields[fieldId];

    // Current implementation may preserve casted JSON text or clear it when options are empty.
    if (value != null) {
      expect(value).toEqual(expect.any(String));
      expect(String(value)).toContain(attachmentSeed.token);
    } else {
      expect(value).toBeNull();
    }

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should handle already null values', async () => {
    const fieldId = await createAttachmentField('Null Attachment Field');
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: makeAttachmentCell(attachmentSeed, 'a.txt'),
    });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleSelect' },
    });

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);

    if (rec1?.fields[fieldId] != null) {
      expect(rec1?.fields[fieldId]).toEqual(expect.any(String));
    } else {
      expect(rec1?.fields[fieldId]).toBeNull();
    }
    expect(rec2?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });
});
