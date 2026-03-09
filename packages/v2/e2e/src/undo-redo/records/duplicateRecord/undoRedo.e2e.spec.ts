import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';
import {
  createBasicTable,
  executeRedo,
  executeUndo,
  findFieldId,
} from '../../shared/undoRedoE2eTestKit';

describe('undo-redo/duplicateRecord (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('undoes duplicated records and redoes them with the copied values intact', async () => {
    const table = await createBasicTable(ctx, 'Undo E2E DuplicateRecord');
    const titleFieldId = findFieldId(table, 'Title');
    const amountFieldId = findFieldId(table, 'Amount');
    const source = await ctx.createRecord(table.id, {
      [titleFieldId]: 'Alpha',
      [amountFieldId]: 8,
    });

    const duplicate = await ctx.duplicateRecord(table.id, source.id);
    expect(
      (await ctx.listRecords(table.id)).find((item) => item.id === duplicate.id)?.fields[
        amountFieldId
      ]
    ).toBe(8);

    await executeUndo(ctx, table.id);
    expect(
      (await ctx.listRecords(table.id)).find((item) => item.id === duplicate.id)
    ).toBeUndefined();

    await executeRedo(ctx, table.id);
    expect(
      (await ctx.listRecords(table.id)).find((item) => item.id === duplicate.id)?.fields[
        amountFieldId
      ]
    ).toBe(8);
  });
});
