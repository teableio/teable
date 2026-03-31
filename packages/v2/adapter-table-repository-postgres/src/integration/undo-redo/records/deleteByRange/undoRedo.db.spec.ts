/* eslint-disable @typescript-eslint/naming-convention */
import {
  CreateRecordsCommand,
  DeleteByRangeCommand,
  type CreateRecordsResult,
  v2CoreTokens,
  type IUndoRedoStore,
} from '@teable/v2-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createBasicTable,
  createUndoRedoDbHarness,
  disposeHarness,
  fetchRowById,
  findField,
  getViewId,
  type UndoRedoDbHarness,
} from '../../shared/undoRedoDbTestKit';

describe('undo-redo/deleteByRange (db)', () => {
  let harness: UndoRedoDbHarness | undefined;

  beforeEach(async () => {
    harness = await createUndoRedoDbHarness();
  });

  afterEach(async () => {
    await disposeHarness(harness);
    harness = undefined;
  });

  it('replays restore on undo and delete on redo for ranged row deletion', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo DeleteByRange');
    const viewId = getViewId(table);
    const titleField = findField(table, 'Title');
    const amountField = findField(table, 'Amount');
    const store = harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);

    const createResult = await harness.execute<CreateRecordsCommand, CreateRecordsResult>(
      CreateRecordsCommand.create({
        tableId: table.id().toString(),
        records: [
          { fields: { [titleField.id().toString()]: 'Alpha', [amountField.id().toString()]: 1 } },
          { fields: { [titleField.id().toString()]: 'Beta', [amountField.id().toString()]: 2 } },
          { fields: { [titleField.id().toString()]: 'Gamma', [amountField.id().toString()]: 3 } },
        ],
      })._unsafeUnwrap()
    );

    const deletedId = createResult.records[1]!.id().toString();

    await harness.execute(
      DeleteByRangeCommand.create({
        tableId: table.id().toString(),
        viewId,
        type: 'rows',
        ranges: [[1, 1]],
      })._unsafeUnwrap()
    );

    const entry = (
      await store.list({
        actorId: harness.context.actorId,
        tableId: table.id(),
        windowId: harness.context.windowId!,
      })
    )
      ._unsafeUnwrap()
      .at(-1);

    expect(entry?.undoCommand.type).toBe('RestoreRecords');
    expect(entry?.redoCommand.type).toBe('DeleteRecords');
    expect(await fetchRowById(harness.db, table, deletedId)).toBeUndefined();

    await harness.undo(table.id().toString());
    expect(harness.probe.names()).toEqual(['UndoCommand', 'RestoreRecordsCommand']);
    expect(await fetchRowById(harness.db, table, deletedId)).toBeDefined();

    await harness.redo(table.id().toString());
    expect(harness.probe.names()).toEqual(['RedoCommand', 'DeleteRecordsCommand']);
    expect(await fetchRowById(harness.db, table, deletedId)).toBeUndefined();
  });
});
