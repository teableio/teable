import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';
import {
  createBasicTable,
  executeRedo,
  executeUndo,
  findFieldId,
  getViewId,
} from '../../shared/undoRedoE2eTestKit';

describe('undo-redo/clear (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('undoes cleared cells and redoes them', async () => {
    const table = await createBasicTable(ctx, 'Undo E2E Clear');
    const viewId = getViewId(table);
    const titleFieldId = findFieldId(table, 'Title');
    const amountFieldId = findFieldId(table, 'Amount');
    const records = await ctx.createRecords(table.id, [
      { fields: { [titleFieldId]: 'Alpha', [amountFieldId]: 11 } },
      { fields: { [titleFieldId]: 'Beta', [amountFieldId]: 22 } },
    ]);

    await ctx.clear({
      tableId: table.id,
      viewId,
      ranges: [
        [1, 0],
        [1, 1],
      ],
    });

    let listed = await ctx.listRecords(table.id);
    expect(listed.find((item) => item.id === records[0]!.id)?.fields[amountFieldId]).toBeNull();
    expect(listed.find((item) => item.id === records[1]!.id)?.fields[amountFieldId]).toBeNull();

    await executeUndo(ctx, table.id);
    listed = await ctx.listRecords(table.id);
    expect(listed.find((item) => item.id === records[0]!.id)?.fields[amountFieldId]).toBe(11);
    expect(listed.find((item) => item.id === records[1]!.id)?.fields[amountFieldId]).toBe(22);

    await executeRedo(ctx, table.id);
    listed = await ctx.listRecords(table.id);
    expect(listed.find((item) => item.id === records[0]!.id)?.fields[amountFieldId]).toBeNull();
    expect(listed.find((item) => item.id === records[1]!.id)?.fields[amountFieldId]).toBeNull();
  });
});
