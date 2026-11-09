/* eslint-disable @typescript-eslint/naming-convention */
import {
  CreateRecordCommand,
  DuplicateRecordCommand,
  v2CoreTokens,
  type CreateRecordResult,
  type DuplicateRecordResult,
  type IUndoRedoStore,
} from '@teable/v2-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createBasicTable,
  createUndoRedoDbHarness,
  disposeHarness,
  fetchRowById,
  findField,
  getFieldDbName,
  type UndoRedoDbHarness,
} from '../../shared/undoRedoDbTestKit';

describe('undo-redo/duplicateRecord (db)', () => {
  let harness: UndoRedoDbHarness | undefined;

  beforeEach(async () => {
    harness = await createUndoRedoDbHarness();
  });

  afterEach(async () => {
    await disposeHarness(harness);
    harness = undefined;
  });

  it('replays delete on undo and restore on redo for duplicated rows', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo Duplicate Record');
    const titleField = findField(table, 'Title');
    const amountField = findField(table, 'Amount');
    const amountDbName = getFieldDbName(table, 'Amount');
    const store = harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);

    const source = await harness.execute<CreateRecordCommand, CreateRecordResult>(
      CreateRecordCommand.create({
        tableId: table.id().toString(),
        fields: {
          [titleField.id().toString()]: 'Alpha',
          [amountField.id().toString()]: 8,
        },
      })._unsafeUnwrap()
    );

    const duplicateResult = await harness.execute<DuplicateRecordCommand, DuplicateRecordResult>(
      DuplicateRecordCommand.create({
        tableId: table.id().toString(),
        recordId: source.record.id().toString(),
      })._unsafeUnwrap()
    );

    const duplicateId = duplicateResult.record.id().toString();
    const entry = (
      await store.list({
        actorId: harness.context.actorId,
        tableId: table.id(),
        windowId: harness.context.windowId!,
      })
    )
      ._unsafeUnwrap()
      .at(-1);

    expect(entry?.undoCommand.type).toBe('DeleteRecords');
    expect(entry?.redoCommand.type).toBe('RestoreRecords');
    expect((await fetchRowById(harness.db, table, duplicateId))?.[amountDbName]).toBe(8);

    await harness.undo(table.id().toString());
    expect(harness.probe.names()).toEqual(['UndoCommand', 'DeleteRecordsCommand']);
    expect(await fetchRowById(harness.db, table, duplicateId)).toBeUndefined();

    await harness.redo(table.id().toString());
    expect(harness.probe.names()).toEqual(['RedoCommand', 'RestoreRecordsCommand']);
    expect((await fetchRowById(harness.db, table, duplicateId))?.[amountDbName]).toBe(8);
  });

  it('keeps duplicates created without a window or during replay out of the window undo stack', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo Duplicate Record Ignored Context');
    const titleField = findField(table, 'Title');
    const amountField = findField(table, 'Amount');
    const amountDbName = getFieldDbName(table, 'Amount');

    const source = await harness.execute<CreateRecordCommand, CreateRecordResult>(
      CreateRecordCommand.create({
        tableId: table.id().toString(),
        fields: {
          [titleField.id().toString()]: 'Window Source',
          [amountField.id().toString()]: 5,
        },
      })._unsafeUnwrap()
    );
    const sourceId = source.record.id().toString();

    const withoutWindow = await harness.execute<DuplicateRecordCommand, DuplicateRecordResult>(
      DuplicateRecordCommand.create({
        tableId: table.id().toString(),
        recordId: sourceId,
      })._unsafeUnwrap(),
      { actorId: harness.context.actorId }
    );
    const duringReplay = await harness.execute<DuplicateRecordCommand, DuplicateRecordResult>(
      DuplicateRecordCommand.create({
        tableId: table.id().toString(),
        recordId: sourceId,
      })._unsafeUnwrap(),
      { ...harness.context, undoRedo: { mode: 'undo' } }
    );
    const untrackedIds = [
      withoutWindow.record.id().toString(),
      duringReplay.record.id().toString(),
    ];

    for (const id of untrackedIds) {
      expect((await fetchRowById(harness.db, table, id))?.[amountDbName]).toBe(5);
    }

    await harness.undo(table.id().toString());
    expect(await fetchRowById(harness.db, table, sourceId)).toBeUndefined();
    for (const id of untrackedIds) {
      expect((await fetchRowById(harness.db, table, id))?.[amountDbName]).toBe(5);
    }

    await harness.redo(table.id().toString());
    expect((await fetchRowById(harness.db, table, sourceId))?.[amountDbName]).toBe(5);
    for (const id of untrackedIds) {
      expect((await fetchRowById(harness.db, table, id))?.[amountDbName]).toBe(5);
    }
  });
});
