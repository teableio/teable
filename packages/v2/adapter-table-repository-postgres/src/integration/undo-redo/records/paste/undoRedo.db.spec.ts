/* eslint-disable @typescript-eslint/naming-convention */
import {
  CreateRecordsCommand,
  PasteCommand,
  type CreateRecordsResult,
  type PasteResult,
  v2CoreTokens,
  type IUndoRedoStore,
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
  getSelectOptionNames,
  getViewId,
  loadTable,
  type UndoRedoDbHarness,
} from '../../shared/undoRedoDbTestKit';

describe('undo-redo/paste (db)', () => {
  let harness: UndoRedoDbHarness | undefined;

  beforeEach(async () => {
    harness = await createUndoRedoDbHarness();
  });

  afterEach(async () => {
    await disposeHarness(harness);
    harness = undefined;
  });

  it('replays batch delete/update on undo and update/restore on redo', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo Paste');
    const viewId = getViewId(table);
    const titleField = findField(table, 'Title');
    const amountField = findField(table, 'Amount');
    const titleDbName = getFieldDbName(table, 'Title');
    const amountDbName = getFieldDbName(table, 'Amount');
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

    const pasteResult = await harness.execute<PasteCommand, PasteResult>(
      PasteCommand.create({
        tableId: table.id().toString(),
        viewId,
        ranges: [
          [0, 0],
          [1, 2],
        ],
        content: [
          ['Paste Row 0', 100],
          ['Paste Row 1', 200],
          ['Paste Row 2', 300],
        ],
      })._unsafeUnwrap()
    );

    const firstId = createResult.records[0]!.id().toString();
    const secondId = createResult.records[1]!.id().toString();
    const createdId = pasteResult.createdRecordIds[0]!;

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
    expect((await fetchRowById(harness.db, table, firstId))?.[titleDbName]).toBe('Paste Row 0');
    expect((await fetchRowById(harness.db, table, secondId))?.[amountDbName]).toBe(200);
    expect((await fetchRowById(harness.db, table, createdId))?.[amountDbName]).toBe(300);

    await harness.undo(table.id().toString());
    expect(harness.probe.names()[0]).toBe('UndoCommand');
    expect(harness.probe.names()).toContain('DeleteRecordsCommand');
    expect(harness.probe.names().filter((name) => name === 'UpdateRecordsCommand')).toHaveLength(1);
    expect((await fetchRowById(harness.db, table, firstId))?.[titleDbName]).toBe('Alpha');
    expect((await fetchRowById(harness.db, table, secondId))?.[amountDbName]).toBe(2);
    expect(await fetchRowById(harness.db, table, createdId)).toBeUndefined();

    await harness.redo(table.id().toString());
    expect(harness.probe.names()[0]).toBe('RedoCommand');
    expect(harness.probe.names()).toContain('RestoreRecordsCommand');
    expect(harness.probe.names().filter((name) => name === 'UpdateRecordsCommand')).toHaveLength(1);
    expect((await fetchRowById(harness.db, table, firstId))?.[titleDbName]).toBe('Paste Row 0');
    expect((await fetchRowById(harness.db, table, secondId))?.[amountDbName]).toBe(200);
    expect((await fetchRowById(harness.db, table, createdId))?.[amountDbName]).toBe(300);
  });

  it('undoes and redoes select-option schema side effects for paste', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createSelectTable(harness, 'Undo Paste Select Options');
    const viewId = getViewId(table);
    const titleField = findField(table, 'Title');
    const statusField = findField(table, 'Status');
    const tagsField = findField(table, 'Tags');
    const statusDbName = getFieldDbName(table, 'Status');
    const tagsDbName = getFieldDbName(table, 'Tags');
    const store = harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);

    const createResult = await harness.execute<CreateRecordsCommand, CreateRecordsResult>(
      CreateRecordsCommand.create({
        tableId: table.id().toString(),
        records: [
          {
            fields: {
              [titleField.id().toString()]: 'Alpha',
              [statusField.id().toString()]: 'Open',
              [tagsField.id().toString()]: ['Tag A'],
            },
          },
        ],
      })._unsafeUnwrap()
    );

    await harness.execute<PasteCommand, PasteResult>(
      PasteCommand.create({
        tableId: table.id().toString(),
        viewId,
        typecast: true,
        ranges: [
          [0, 0],
          [2, 1],
        ],
        content: [
          ['Paste Row 0', 'In Progress', 'Tag A, Tag Z'],
          ['Paste Row 1', 'Open', 'Tag A'],
        ],
      })._unsafeUnwrap()
    );

    const existingId = createResult.records[0]!.id().toString();
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
    expect(harness.probe.names()[0]).toBe('UndoCommand');
    expect(harness.probe.names()).toContain('DeleteRecordsCommand');
    expect(harness.probe.names()).toContain('UpdateRecordsCommand');
    expect(
      harness.probe.names().filter((name) => name === 'ApplyFieldSnapshotCommand')
    ).toHaveLength(2);
    loadedTable = await loadTable(harness, table);
    expect(getSelectOptionNames(loadedTable, 'Status')).toEqual(['Open']);
    expect(getSelectOptionNames(loadedTable, 'Tags')).toEqual(['Tag A']);
    const undoneRow = await fetchRowById(harness.db, loadedTable, existingId);
    expect(undoneRow?.[statusDbName]).toBe('Open');
    expect(undoneRow?.[tagsDbName]).toEqual(['Tag A']);

    await harness.redo(table.id().toString());
    expect(harness.probe.names()[0]).toBe('RedoCommand');
    expect(harness.probe.names()).toContain('RestoreRecordsCommand');
    expect(harness.probe.names()).toContain('UpdateRecordsCommand');
    expect(
      harness.probe.names().filter((name) => name === 'ApplyFieldSnapshotCommand')
    ).toHaveLength(2);
    loadedTable = await loadTable(harness, table);
    expect(getSelectOptionNames(loadedTable, 'Status')).toEqual(['Open', 'In Progress']);
    expect(getSelectOptionNames(loadedTable, 'Tags')).toEqual(['Tag A', 'Tag Z']);
  });
});
