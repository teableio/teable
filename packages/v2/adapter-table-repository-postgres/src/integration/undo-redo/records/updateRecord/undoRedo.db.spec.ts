/* eslint-disable @typescript-eslint/naming-convention */
import {
  CreateRecordCommand,
  UpdateRecordCommand,
  v2CoreTokens,
  type CreateRecordResult,
  type IUndoRedoStore,
  type UpdateRecordResult,
} from '@teable/v2-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createBasicTable,
  createSelectTable,
  createUndoRedoDbHarness,
  disposeHarness,
  fetchRowById,
  findField,
  getFieldDbName,
  getViewId,
  getSelectOptionNames,
  listRowsByViewOrder,
  loadTable,
  type UndoRedoDbHarness,
} from '../../shared/undoRedoDbTestKit';

describe('undo-redo/updateRecord (db)', () => {
  let harness: UndoRedoDbHarness | undefined;

  beforeEach(async () => {
    harness = await createUndoRedoDbHarness();
  });

  afterEach(async () => {
    await disposeHarness(harness);
    harness = undefined;
  });

  it('replays update with old values on undo and new values on redo', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo Update Record');
    const titleField = findField(table, 'Title');
    const amountField = findField(table, 'Amount');
    const titleDbName = getFieldDbName(table, 'Title');
    const amountDbName = getFieldDbName(table, 'Amount');
    const store = harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);

    const record = await harness.execute<CreateRecordCommand, CreateRecordResult>(
      CreateRecordCommand.create({
        tableId: table.id().toString(),
        fields: {
          [titleField.id().toString()]: 'Original',
          [amountField.id().toString()]: 10,
        },
      })._unsafeUnwrap()
    );

    await harness.execute<UpdateRecordCommand, UpdateRecordResult>(
      UpdateRecordCommand.create({
        tableId: table.id().toString(),
        recordId: record.record.id().toString(),
        fields: {
          [titleField.id().toString()]: 'Updated',
          [amountField.id().toString()]: 99,
        },
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

    expect(entry?.undoCommand.type).toBe('UpdateRecord');
    expect(entry?.redoCommand.type).toBe('UpdateRecord');

    const updatedRow = await fetchRowById(harness.db, table, record.record.id().toString());
    expect(updatedRow?.[titleDbName]).toBe('Updated');
    expect(updatedRow?.[amountDbName]).toBe(99);

    await harness.undo(table.id().toString());
    expect(harness.probe.names()).toEqual(['UndoCommand', 'UpdateRecordCommand']);
    const undoneRow = await fetchRowById(harness.db, table, record.record.id().toString());
    expect(undoneRow?.[titleDbName]).toBe('Original');
    expect(undoneRow?.[amountDbName]).toBe(10);

    await harness.redo(table.id().toString());
    expect(harness.probe.names()).toEqual(['RedoCommand', 'UpdateRecordCommand']);
    const redoneRow = await fetchRowById(harness.db, table, record.record.id().toString());
    expect(redoneRow?.[titleDbName]).toBe('Updated');
    expect(redoneRow?.[amountDbName]).toBe(99);
  });

  it('undoes and redoes select-option schema side effects around record updates', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createSelectTable(harness, 'Undo Update Record Select Options');
    const titleField = findField(table, 'Title');
    const statusField = findField(table, 'Status');
    const tagsField = findField(table, 'Tags');
    const statusDbName = getFieldDbName(table, 'Status');
    const tagsDbName = getFieldDbName(table, 'Tags');
    const store = harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);

    const record = await harness.execute<CreateRecordCommand, CreateRecordResult>(
      CreateRecordCommand.create({
        tableId: table.id().toString(),
        fields: {
          [titleField.id().toString()]: 'Original',
          [statusField.id().toString()]: 'Open',
          [tagsField.id().toString()]: ['Tag A'],
        },
      })._unsafeUnwrap()
    );

    await harness.execute<UpdateRecordCommand, UpdateRecordResult>(
      UpdateRecordCommand.create({
        tableId: table.id().toString(),
        recordId: record.record.id().toString(),
        typecast: true,
        fields: {
          [statusField.id().toString()]: 'In Progress',
          [tagsField.id().toString()]: ['Tag A', 'Tag Z'],
        },
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

    expect(entry?.undoCommand.type).toBe('Batch');
    expect(entry?.redoCommand.type).toBe('Batch');

    let loadedTable = await loadTable(harness, table);
    expect(getSelectOptionNames(loadedTable, 'Status')).toEqual(['Open', 'In Progress']);
    expect(getSelectOptionNames(loadedTable, 'Tags')).toEqual(['Tag A', 'Tag Z']);
    let updatedRow = await fetchRowById(harness.db, loadedTable, record.record.id().toString());
    expect(updatedRow?.[statusDbName]).toBe('In Progress');
    expect(updatedRow?.[tagsDbName]).toEqual(['Tag A', 'Tag Z']);

    await harness.undo(table.id().toString());
    expect(harness.probe.names()).toEqual([
      'UndoCommand',
      'UpdateRecordsCommand',
      'ApplyFieldSnapshotCommand',
      'UpdateFieldCommand',
      'ApplyFieldSnapshotCommand',
      'UpdateFieldCommand',
    ]);
    loadedTable = await loadTable(harness, table);
    expect(getSelectOptionNames(loadedTable, 'Status')).toEqual(['Open']);
    expect(getSelectOptionNames(loadedTable, 'Tags')).toEqual(['Tag A']);
    updatedRow = await fetchRowById(harness.db, loadedTable, record.record.id().toString());
    expect(updatedRow?.[statusDbName]).toBe('Open');
    expect(updatedRow?.[tagsDbName]).toEqual(['Tag A']);

    await harness.redo(table.id().toString());
    expect(harness.probe.names()).toEqual([
      'RedoCommand',
      'ApplyFieldSnapshotCommand',
      'UpdateFieldCommand',
      'ApplyFieldSnapshotCommand',
      'UpdateFieldCommand',
      'UpdateRecordsCommand',
    ]);
    loadedTable = await loadTable(harness, table);
    expect(getSelectOptionNames(loadedTable, 'Status')).toEqual(['Open', 'In Progress']);
    expect(getSelectOptionNames(loadedTable, 'Tags')).toEqual(['Tag A', 'Tag Z']);
    updatedRow = await fetchRowById(harness.db, loadedTable, record.record.id().toString());
    expect(updatedRow?.[statusDbName]).toBe('In Progress');
    expect(updatedRow?.[tagsDbName]).toEqual(['Tag A', 'Tag Z']);
  });

  it('undoes and redoes record value updates together with row-order changes', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo Update Record With Order');
    const titleField = findField(table, 'Title');
    const viewId = getViewId(table);

    const recordA = await harness.execute<CreateRecordCommand, CreateRecordResult>(
      CreateRecordCommand.create({
        tableId: table.id().toString(),
        fields: {
          [titleField.id().toString()]: 'A',
        },
      })._unsafeUnwrap()
    );
    const recordB = await harness.execute<CreateRecordCommand, CreateRecordResult>(
      CreateRecordCommand.create({
        tableId: table.id().toString(),
        fields: {
          [titleField.id().toString()]: 'B',
        },
      })._unsafeUnwrap()
    );

    await harness.execute<UpdateRecordCommand, UpdateRecordResult>(
      UpdateRecordCommand.create({
        tableId: table.id().toString(),
        recordId: recordB.record.id().toString(),
        fields: {
          [titleField.id().toString()]: 'B updated',
        },
        order: {
          viewId,
          anchorId: recordA.record.id().toString(),
          position: 'before',
        },
      })._unsafeUnwrap()
    );

    const entry = (
      await harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore).list({
        actorId: harness.context.actorId,
        tableId: table.id(),
        windowId: harness.context.windowId!,
      })
    )
      ._unsafeUnwrap()
      .at(-1);

    expect(entry?.undoCommand.type).toBe('Batch');
    if (entry?.undoCommand.type === 'Batch') {
      expect(entry.undoCommand.payload.map((command) => command.type)).toEqual([
        'UpdateRecord',
        'ApplyRecordOrders',
      ]);
      const orderCommand = entry.undoCommand.payload[1];
      if (orderCommand?.type === 'ApplyRecordOrders') {
        expect(orderCommand.payload.records[0]?.recordId).toBe(recordB.record.id().toString());
        expect(orderCommand.payload.records[0]?.order).toBeTypeOf('number');
      }
    }

    let orderedRows = await listRowsByViewOrder(harness.db, table, viewId);
    expect(orderedRows.map((row) => row.__id)).toEqual([
      recordB.record.id().toString(),
      recordA.record.id().toString(),
    ]);

    await harness.undo(table.id().toString());
    orderedRows = await listRowsByViewOrder(harness.db, table, viewId);
    expect(orderedRows.map((row) => row.__id)).toEqual([
      recordA.record.id().toString(),
      recordB.record.id().toString(),
    ]);
    const undoneRow = await fetchRowById(harness.db, table, recordB.record.id().toString());
    expect(undoneRow?.[getFieldDbName(table, 'Title')]).toBe('B');

    await harness.redo(table.id().toString());
    orderedRows = await listRowsByViewOrder(harness.db, table, viewId);
    expect(orderedRows.map((row) => row.__id)).toEqual([
      recordB.record.id().toString(),
      recordA.record.id().toString(),
    ]);
    const redoneRow = await fetchRowById(harness.db, table, recordB.record.id().toString());
    expect(redoneRow?.[getFieldDbName(table, 'Title')]).toBe('B updated');
  });
});
