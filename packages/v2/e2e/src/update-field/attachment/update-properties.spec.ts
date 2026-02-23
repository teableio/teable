/**
 * E2E tests for updating Attachment field properties.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';
import {
  ensureAttachmentTables,
  makeAttachmentCell,
  seedAttachment,
  type SeededAttachment,
} from './testUtils';

let globalFieldIdCounter = 0;
const createGlobalFieldId = () => {
  const suffix = globalFieldIdCounter.toString(36).padStart(16, '0');
  globalFieldIdCounter += 1;
  return `fld${suffix}`;
};

describe('update-field: attachment property updates', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;
  let attachmentSeed: SeededAttachment;

  const createAttachmentField = async (name: string) => {
    const fieldId = createGlobalFieldId();
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
      name: 'Attachment Update Properties',
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

  test('should update field name and preserve values', async () => {
    const fieldId = await createAttachmentField('Files');
    const rec = await ctx.createRecord(tableId, {
      [fieldId]: makeAttachmentCell(attachmentSeed, 'rename.txt'),
    });

    const before = await ctx.listRecords(tableId);
    const beforeValue = before.find((r) => r.id === rec.id)?.fields[fieldId];

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: {
        name: 'Documents',
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.name).toBe('Documents');
    expect(updatedField?.type).toBe('attachment');

    const after = await ctx.listRecords(tableId);
    const afterValue = after.find((r) => r.id === rec.id)?.fields[fieldId];
    expect(afterValue).toEqual(beforeValue);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [rec.id]);
  });

  test('should update notNull constraint', async () => {
    const fieldId = await createAttachmentField('Required Files');

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: {
        notNull: true,
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('attachment');
    expect(updatedField?.notNull).toBe(true);

    await ctx.deleteField({ tableId, fieldId });
  });
});

describe('update-field: attachment conversions', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;
  let attachmentSeed: SeededAttachment;

  const createAttachmentField = async (name: string) => {
    const fieldId = createGlobalFieldId();
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
      name: 'Attachment Conversion In Update Properties',
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

  test('should convert attachment to text (JSON)', async () => {
    const fieldId = await createAttachmentField('Attachment to Text');
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: makeAttachmentCell(attachmentSeed, 'to-text.txt'),
    });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('singleLineText');

    const records = await ctx.listRecords(tableId);
    const value = records.find((r) => r.id === r1.id)?.fields[fieldId];
    expect(value).toEqual(expect.any(String));
    expect(String(value)).toContain(attachmentSeed.token);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should NOT convert attachment to number', async () => {
    const fieldId = await createAttachmentField('Attachment to Number');
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: makeAttachmentCell(attachmentSeed, 'to-number.txt'),
    });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'number' },
    });

    const records = await ctx.listRecords(tableId);
    const value = records.find((r) => r.id === r1.id)?.fields[fieldId];
    expect(value).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should NOT convert attachment to checkbox', async () => {
    const fieldId = await createAttachmentField('Attachment to Checkbox');
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: makeAttachmentCell(attachmentSeed, 'to-checkbox.txt'),
    });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'checkbox' },
    });

    const records = await ctx.listRecords(tableId);
    const v1 = records.find((r) => r.id === r1.id)?.fields[fieldId];
    const v2 = records.find((r) => r.id === r2.id)?.fields[fieldId];
    expect(v1).toBe(true);
    expect(v2).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should NOT convert text to attachment', async () => {
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleLineText',
        id: fieldId,
        name: 'Text Field',
      },
    });

    const r1 = await ctx.createRecord(tableId, { [fieldId]: 'just text' });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'attachment' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('attachment');

    const records = await ctx.listRecords(tableId);
    const v1 = records.find((r) => r.id === r1.id)?.fields[fieldId];
    const v2 = records.find((r) => r.id === r2.id)?.fields[fieldId];
    expect(v1).toBeNull();
    expect(v2).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });
});
