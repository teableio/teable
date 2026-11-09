import { UpdateFieldCommand } from '@teable/v2-core';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';
import {
  buildUndoRedoContext,
  executeRedo,
  executeUndo,
  getCommandBus,
} from '../../undo-redo/shared/undoRedoE2eTestKit';

interface ForeignTableRef {
  id: string;
  fields: Array<{ id: string; isPrimary?: boolean }>;
}

describe('type conversion replay snapshots', () => {
  let ctx: SharedTestContext;
  const cleanupTableIds: string[] = [];

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  afterEach(async () => {
    for (const tableId of cleanupTableIds.splice(0)) {
      await ctx.deleteTable(tableId);
    }
  });

  const convertToLink = async (
    tableId: string,
    fieldId: string,
    foreignTable: ForeignTableRef,
    isOneWay: boolean,
    windowId: string
  ) => {
    const result = await getCommandBus(ctx).execute(
      buildUndoRedoContext(windowId),
      UpdateFieldCommand.create({
        tableId,
        fieldId,
        field: {
          type: 'link',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignTable.fields.find((field) => field.isPrimary)!.id,
            isOneWay,
          },
        },
      })._unsafeUnwrap()
    );
    if (result.isErr()) throw new Error(result.error.message);
  };

  test('replays a text to one-way self-link conversion as a link', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Self conversion snapshot',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    cleanupTableIds.push(table.id);
    const withText = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: { type: 'singleLineText', name: 'Convertible' },
    });
    const fieldId = withText.fields.find((field) => field.name === 'Convertible')!.id;

    // A one-way self-link reuses the same table as its foreign table and adds no
    // reciprocal field, so the converted aggregate must come from storage.
    const windowId = 'one-way-self-conversion';
    await convertToLink(table.id, fieldId, table, true, windowId);

    const converted = await ctx.getTableById(table.id);
    expect(converted.fields.find((field) => field.id === fieldId)!.type).toBe('link');

    await executeUndo(ctx, table.id, windowId);
    const undone = await ctx.getTableById(table.id);
    expect(undone.fields.find((field) => field.id === fieldId)!.type).toBe('singleLineText');

    await executeRedo(ctx, table.id, windowId);
    const redone = await ctx.getTableById(table.id);
    expect(redone.fields.find((field) => field.id === fieldId)!.type).toBe('link');
  });
});
