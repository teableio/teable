import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';
import {
  createBasicTable,
  executeRedo,
  executeUndo,
  findFieldId,
  getViewId,
  listFieldIdsByViewOrder,
} from '../../shared/undoRedoE2eTestKit';

describe('undo-redo/deleteField ordering (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('restores the same field id and visible order after delete undo/redo', async () => {
    const table = await createBasicTable(ctx, 'Undo E2E DeleteField Ordering');
    const titleFieldId = findFieldId(table, 'Title');
    const amountFieldId = findFieldId(table, 'Amount');
    const viewId = getViewId(table);

    await ctx.deleteField({ tableId: table.id, fieldId: amountFieldId });
    expect(await listFieldIdsByViewOrder(ctx, table.id, viewId)).toEqual([titleFieldId]);

    await executeUndo(ctx, table.id);
    expect(await listFieldIdsByViewOrder(ctx, table.id, viewId)).toEqual([
      titleFieldId,
      amountFieldId,
    ]);

    await executeRedo(ctx, table.id);
    expect(await listFieldIdsByViewOrder(ctx, table.id, viewId)).toEqual([titleFieldId]);
  });
});
