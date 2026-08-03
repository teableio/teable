import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';
import { executeUndo } from '../../shared/undoRedoE2eTestKit';

describe('undo-redo/deleteField link show-by lookup (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('falls back link titles to the foreign primary field after deleting the lookup target and restores them on undo', async () => {
    let foreignId: string | undefined;
    let hostId: string | undefined;

    try {
      const foreign = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Undo Delete Lookup Target Foreign',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      foreignId = foreign.id;
      const host = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Undo Delete Lookup Target Host',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      hostId = host.id;

      const foreignDisplayFieldId = `fld${'d'.repeat(16)}`;
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: foreign.id,
        field: {
          type: 'singleLineText',
          id: foreignDisplayFieldId,
          name: 'Display',
        },
      });

      const linkFieldId = `fld${'l'.repeat(16)}`;
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
        field: {
          type: 'link',
          id: linkFieldId,
          name: 'Foreign Link',
          options: {
            relationship: 'oneOne',
            foreignTableId: foreign.id,
            lookupFieldId: foreignDisplayFieldId,
            isOneWay: true,
          },
        },
      });

      const foreignRecord = await ctx.createRecord(foreign.id, {
        [foreign.fields[0]!.id]: 'A1',
        [foreignDisplayFieldId]: 'H1',
      });
      const hostRecord = await ctx.createRecord(host.id, {
        [host.fields[0]!.id]: 'Host 1',
      });

      await ctx.updateRecord(host.id, hostRecord.id, {
        [linkFieldId]: { id: foreignRecord.id },
      });
      await ctx.drainOutbox();

      const hostBeforeDelete = (await ctx.listRecords(host.id)).find(
        (record) => record.id === hostRecord.id
      );
      expect(hostBeforeDelete?.fields[linkFieldId]).toEqual({
        id: foreignRecord.id,
        title: 'H1',
      });

      await ctx.deleteField({ tableId: foreign.id, fieldId: foreignDisplayFieldId });
      await ctx.drainOutbox();

      const hostAfterDelete = (await ctx.listRecords(host.id)).find(
        (record) => record.id === hostRecord.id
      );
      expect(hostAfterDelete?.fields[linkFieldId]).toEqual({
        id: foreignRecord.id,
        title: 'A1',
      });

      await executeUndo(ctx, foreign.id);
      await ctx.drainOutbox();

      const hostAfterUndo = (await ctx.listRecords(host.id)).find(
        (record) => record.id === hostRecord.id
      );
      expect(hostAfterUndo?.fields[linkFieldId]).toEqual({
        id: foreignRecord.id,
        title: 'H1',
      });
    } finally {
      if (hostId) {
        await ctx.deleteTable(hostId);
      }
      if (foreignId) {
        await ctx.deleteTable(foreignId);
      }
    }
  });
});
