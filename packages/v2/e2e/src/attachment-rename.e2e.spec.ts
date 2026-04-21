/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';
import {
  ensureAttachmentTables,
  seedAttachment,
  makeAttachmentCell,
} from './update-field/attachment/testUtils';

describe('v2 attachment rename (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    await ensureAttachmentTables(ctx);
  });

  it('persists renamed attachment name after record update', async () => {
    const seeded = await seedAttachment(ctx);

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Attachment Rename Test',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'attachment', name: 'Files' },
      ],
      views: [{ type: 'grid' }],
    });
    const titleFieldId = table.fields.find((f) => f.name === 'Title')?.id ?? '';
    const attachmentFieldId = table.fields.find((f) => f.name === 'Files')?.id ?? '';

    // Create record with attachment using original name
    const originalCell = makeAttachmentCell(seeded, 'original-name.txt');
    const record = await ctx.createRecord(table.id, {
      [titleFieldId]: 'Row 1',
      [attachmentFieldId]: originalCell,
    });

    // Verify original name is stored
    const recordsBefore = await ctx.listRecords(table.id);
    const storedBefore = recordsBefore.find((r) => r.id === record.id);
    const attachmentsBefore = storedBefore?.fields[attachmentFieldId] as Array<{
      name: string;
      token: string;
    }>;
    expect(attachmentsBefore[0].name).toBe('original-name.txt');

    // Rename the attachment (same token, different name)
    const updated = await ctx.updateRecord(table.id, record.id, {
      [attachmentFieldId]: [
        {
          ...originalCell[0],
          name: 'renamed-file.txt',
        },
      ],
    });

    // Verify the updateRecord response reflects the new name
    const attachmentFromUpdate = updated.fields[attachmentFieldId] as Array<{
      name: string;
      token: string;
    }>;
    expect(attachmentFromUpdate[0].name).toBe('renamed-file.txt');
    expect(attachmentFromUpdate[0].token).toBe(seeded.token);

    // Verify the rename was persisted
    const recordsAfter = await ctx.listRecords(table.id);
    const storedAfter = recordsAfter.find((r) => r.id === record.id);
    const attachmentsAfter = storedAfter?.fields[attachmentFieldId] as Array<{
      name: string;
      token: string;
    }>;
    expect(attachmentsAfter[0].name).toBe('renamed-file.txt');
    expect(attachmentsAfter[0].token).toBe(seeded.token);
  });
});
