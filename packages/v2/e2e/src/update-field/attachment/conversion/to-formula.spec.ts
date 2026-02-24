/**
 * E2E tests for converting attachment field to formula.
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

describe('update-field: attachment → formula conversion', () => {
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
      name: 'Attachment to Formula Conversion',
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

  test('should reject conversion to formula when expression is missing', async () => {
    const fieldId = await createAttachmentField('Attachment Field');
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: makeAttachmentCell(attachmentSeed, 'a.txt'),
    });

    await expect(
      ctx.updateField({
        tableId,
        fieldId,
        field: {
          type: 'formula',
        },
      })
    ).rejects.toThrow();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should reject conversion to formula when expression is invalid', async () => {
    const fieldId = await createAttachmentField('Null Attachment Field');
    const r1 = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'No value',
    });

    await expect(
      ctx.updateField({
        tableId,
        fieldId,
        field: {
          type: 'formula',
          options: {
            expression: 'INVALID(',
          },
        },
      })
    ).rejects.toThrow();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });
});
