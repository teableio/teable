import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';
import {
  createBasicTable,
  executeRedo,
  executeUndo,
  findFieldId,
  getViewId,
  listRecordIdsByViewOrder,
  reorderRecords,
} from '../../shared/undoRedoE2eTestKit';

describe('undo-redo/reorderRecords (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('undoes reordered rows and redoes the same order', async () => {
    const table = await createBasicTable(ctx, 'Undo E2E ReorderRecords');
    const viewId = getViewId(table);
    const titleFieldId = findFieldId(table, 'Title');
    const amountFieldId = findFieldId(table, 'Amount');
    const records = await ctx.createRecords(table.id, [
      { fields: { [titleFieldId]: 'Alpha', [amountFieldId]: 1 } },
      { fields: { [titleFieldId]: 'Beta', [amountFieldId]: 2 } },
      { fields: { [titleFieldId]: 'Gamma', [amountFieldId]: 3 } },
    ]);

    await reorderRecords(ctx, {
      tableId: table.id,
      recordIds: [records[2]!.id],
      order: {
        viewId,
        anchorId: records[0]!.id,
        position: 'before',
      },
    });
    expect(await listRecordIdsByViewOrder(ctx, table.id, viewId)).toEqual([
      records[2]!.id,
      records[0]!.id,
      records[1]!.id,
    ]);

    await executeUndo(ctx, table.id);
    expect(await listRecordIdsByViewOrder(ctx, table.id, viewId)).toEqual([
      records[0]!.id,
      records[1]!.id,
      records[2]!.id,
    ]);

    await executeRedo(ctx, table.id);
    expect(await listRecordIdsByViewOrder(ctx, table.id, viewId)).toEqual([
      records[2]!.id,
      records[0]!.id,
      records[1]!.id,
    ]);
  });
});
