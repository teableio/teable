/* eslint-disable @typescript-eslint/naming-convention */
import {
  CreateRecordsCommand,
  DeleteRecordsCommand,
  v2CoreTokens,
  type CreateRecordsResult,
  type DeleteRecordsResult,
  type IUndoRedoStore,
} from '@teable/v2-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createBasicTable,
  createUndoRedoDbHarness,
  disposeHarness,
  fetchRowById,
  findField,
  type UndoRedoDbHarness,
} from '../../shared/undoRedoDbTestKit';

describe('undo-redo/deleteRecords (db)', () => {
  let harness: UndoRedoDbHarness | undefined;

  beforeEach(async () => {
    harness = await createUndoRedoDbHarness();
  });

  afterEach(async () => {
    await disposeHarness(harness);
    harness = undefined;
  });

  it('replays restore on undo and delete on redo', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo Delete Records');
    const titleField = findField(table, 'Title');
    const amountField = findField(table, 'Amount');
    const store = harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);

    const createResult = await harness.execute<CreateRecordsCommand, CreateRecordsResult>(
      CreateRecordsCommand.create({
        tableId: table.id().toString(),
        records: [
          {
            fields: {
              [titleField.id().toString()]: 'Alpha',
              [amountField.id().toString()]: 1,
            },
          },
          {
            fields: {
              [titleField.id().toString()]: 'Beta',
              [amountField.id().toString()]: 2,
            },
          },
        ],
      })._unsafeUnwrap()
    );

    const deletedId = createResult.records[0]!.id().toString();

    await harness.execute<DeleteRecordsCommand, DeleteRecordsResult>(
      DeleteRecordsCommand.create({
        tableId: table.id().toString(),
        recordIds: [deletedId],
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
