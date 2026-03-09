/* eslint-disable @typescript-eslint/naming-convention */
import {
  CreateRecordsCommand,
  v2CoreTokens,
  type CreateRecordsResult,
  type IUndoRedoStore,
} from '@teable/v2-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createBasicTable,
  createSelectTable,
  createUndoRedoDbHarness,
  disposeHarness,
  findField,
  getSelectOptionNames,
  listRows,
  loadTable,
  type UndoRedoDbHarness,
} from '../../shared/undoRedoDbTestKit';

describe('undo-redo/createRecords (db)', () => {
  let harness: UndoRedoDbHarness | undefined;

  beforeEach(async () => {
    harness = await createUndoRedoDbHarness();
  });

  afterEach(async () => {
    await disposeHarness(harness);
    harness = undefined;
  });

  it('replays batch delete on undo and restore on redo', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo Create Records');
    const titleField = findField(table, 'Title');
    const amountField = findField(table, 'Amount');
    const store = harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);

    const createCommand = CreateRecordsCommand.create({
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
    })._unsafeUnwrap();

    const createResult = await harness.execute<CreateRecordsCommand, CreateRecordsResult>(
      createCommand
    );
    const createdIds = createResult.records.map((record) => record.id().toString());

    const entry = (
      await store.list({
        actorId: harness.context.actorId,
        tableId: table.id(),
        windowId: harness.context.windowId!,
      })
    )._unsafeUnwrap()[0];

    expect(entry?.undoCommand.type).toBe('DeleteRecords');
    expect(entry?.redoCommand.type).toBe('RestoreRecords');
    if (entry?.undoCommand.type === 'DeleteRecords') {
      expect(entry.undoCommand.payload.recordIds).toEqual(createdIds);
    }

    expect((await listRows(harness.db, table)).map((row) => row.__id)).toEqual(createdIds);

    await harness.undo(table.id().toString());
    expect(harness.probe.names()).toEqual(['UndoCommand', 'DeleteRecordsCommand']);
    expect(await listRows(harness.db, table)).toHaveLength(0);

    await harness.redo(table.id().toString());
    expect(harness.probe.names()).toEqual(['RedoCommand', 'RestoreRecordsCommand']);
    expect((await listRows(harness.db, table)).map((row) => row.__id)).toEqual(createdIds);
  });

  it('undoes and redoes select-option auto creation for batch create', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createSelectTable(harness, 'Undo Create Records Select Options');
    const titleField = findField(table, 'Title');
    const statusField = findField(table, 'Status');
    const tagsField = findField(table, 'Tags');
    const store = harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);

    const createResult = await harness.execute<CreateRecordsCommand, CreateRecordsResult>(
      CreateRecordsCommand.create({
        tableId: table.id().toString(),
        typecast: true,
        records: [
          {
            fields: {
              [titleField.id().toString()]: 'Alpha',
              [statusField.id().toString()]: 'In Progress',
              [tagsField.id().toString()]: ['Tag A', 'Tag Z'],
            },
          },
          {
            fields: {
              [titleField.id().toString()]: 'Beta',
              [statusField.id().toString()]: 'Open',
              [tagsField.id().toString()]: ['Tag A'],
            },
          },
        ],
      })._unsafeUnwrap()
    );

    const createdIds = createResult.records.map((record) => record.id().toString());
    const entry = (
      await store.list({
        actorId: harness.context.actorId,
        tableId: table.id(),
        windowId: harness.context.windowId!,
      })
    )
      ._unsafeUnwrap()
      .at(-1);

    expect(entry?.undoCommand.type).toBe('Batch');
    expect(entry?.redoCommand.type).toBe('Batch');

    let loadedTable = await loadTable(harness, table);
    expect(getSelectOptionNames(loadedTable, 'Status')).toEqual(['Open', 'In Progress']);
    expect(getSelectOptionNames(loadedTable, 'Tags')).toEqual(['Tag A', 'Tag Z']);

    await harness.undo(table.id().toString());
    expect(harness.probe.names()).toEqual([
      'UndoCommand',
      'DeleteRecordsCommand',
      'ApplyFieldSnapshotCommand',
      'UpdateFieldCommand',
      'ApplyFieldSnapshotCommand',
      'UpdateFieldCommand',
    ]);
    loadedTable = await loadTable(harness, table);
    expect(getSelectOptionNames(loadedTable, 'Status')).toEqual(['Open']);
    expect(getSelectOptionNames(loadedTable, 'Tags')).toEqual(['Tag A']);
    expect(await listRows(harness.db, loadedTable)).toHaveLength(0);

    await harness.redo(table.id().toString());
    expect(harness.probe.names()).toEqual([
      'RedoCommand',
      'ApplyFieldSnapshotCommand',
      'UpdateFieldCommand',
      'ApplyFieldSnapshotCommand',
      'UpdateFieldCommand',
      'RestoreRecordsCommand',
    ]);
    loadedTable = await loadTable(harness, table);
    expect(getSelectOptionNames(loadedTable, 'Status')).toEqual(['Open', 'In Progress']);
    expect(getSelectOptionNames(loadedTable, 'Tags')).toEqual(['Tag A', 'Tag Z']);
    expect((await listRows(harness.db, loadedTable)).map((row) => row.__id)).toEqual(createdIds);
  });
});
