import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';
import {
  createBasicTable,
  executeRedo,
  executeUndo,
  findFieldId,
  getViewId,
} from '../../shared/undoRedoE2eTestKit';

describe('undo-redo/deleteByRange (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('undoes ranged row deletion and redoes it', async () => {
    const table = await createBasicTable(ctx, 'Undo E2E DeleteByRange');
    const viewId = getViewId(table);
    const titleFieldId = findFieldId(table, 'Title');
    const amountFieldId = findFieldId(table, 'Amount');
    const records = await ctx.createRecords(table.id, [
      { fields: { [titleFieldId]: 'Alpha', [amountFieldId]: 1 } },
      { fields: { [titleFieldId]: 'Beta', [amountFieldId]: 2 } },
      { fields: { [titleFieldId]: 'Gamma', [amountFieldId]: 3 } },
    ]);

    await ctx.deleteByRange({
      tableId: table.id,
      viewId,
      type: 'rows',
      ranges: [[1, 1]],
    });
    expect(
      (await ctx.listRecords(table.id)).find((item) => item.id === records[1]!.id)
    ).toBeUndefined();

    await executeUndo(ctx, table.id);
    expect(
      (await ctx.listRecords(table.id)).find((item) => item.id === records[1]!.id)?.fields[
        amountFieldId
      ]
    ).toBe(2);

    await executeRedo(ctx, table.id);
    expect(
      (await ctx.listRecords(table.id)).find((item) => item.id === records[1]!.id)
    ).toBeUndefined();
  });
});
