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

describe('undo-redo/createField ordering (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('restores the same field id and visible order after undo/redo', async () => {
    const table = await createBasicTable(ctx, 'Undo E2E CreateField Ordering');
    const titleFieldId = findFieldId(table, 'Title');
    const amountFieldId = findFieldId(table, 'Amount');
    const viewId = getViewId(table);

    const updatedTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        id: `fld${'o'.repeat(16)}`,
        type: 'singleLineText',
        name: 'Notes',
      },
      order: {
        viewId,
        orderIndex: 0.5,
      },
    });
    const notesFieldId = findFieldId(updatedTable, 'Notes');

    expect(await listFieldIdsByViewOrder(ctx, table.id, viewId)).toEqual([
      titleFieldId,
      notesFieldId,
      amountFieldId,
    ]);

    await executeUndo(ctx, table.id);
    expect(await listFieldIdsByViewOrder(ctx, table.id, viewId)).toEqual([
      titleFieldId,
      amountFieldId,
    ]);

    await executeRedo(ctx, table.id);
    expect(await listFieldIdsByViewOrder(ctx, table.id, viewId)).toEqual([
      titleFieldId,
      notesFieldId,
      amountFieldId,
    ]);
  });
});
