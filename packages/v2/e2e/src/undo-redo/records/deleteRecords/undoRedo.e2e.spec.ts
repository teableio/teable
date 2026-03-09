import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';
import {
  createBasicTable,
  executeRedo,
  executeUndo,
  findFieldId,
} from '../../shared/undoRedoE2eTestKit';

describe('undo-redo/deleteRecords (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('undoes record deletion and redoes it', async () => {
    const table = await createBasicTable(ctx, 'Undo E2E DeleteRecords');
    const titleFieldId = findFieldId(table, 'Title');
    const amountFieldId = findFieldId(table, 'Amount');
    const records = await ctx.createRecords(table.id, [
      { fields: { [titleFieldId]: 'Alpha', [amountFieldId]: 1 } },
      { fields: { [titleFieldId]: 'Beta', [amountFieldId]: 2 } },
    ]);

    await ctx.deleteRecords(table.id, [records[0]!.id]);
    expect(
      (await ctx.listRecords(table.id)).find((item) => item.id === records[0]!.id)
    ).toBeUndefined();

    await executeUndo(ctx, table.id);
    expect(
      (await ctx.listRecords(table.id)).find((item) => item.id === records[0]!.id)?.fields[
        amountFieldId
      ]
    ).toBe(1);

    await executeRedo(ctx, table.id);
    expect(
      (await ctx.listRecords(table.id)).find((item) => item.id === records[0]!.id)
    ).toBeUndefined();
  });
});
