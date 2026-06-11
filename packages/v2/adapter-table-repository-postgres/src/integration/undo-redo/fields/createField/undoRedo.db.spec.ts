/* eslint-disable @typescript-eslint/naming-convention */
import {
  CreateFieldCommand,
  CreateRecordCommand,
  v2CoreTokens,
  type CreateFieldResult,
  type CreateRecordResult,
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
  listFieldIdsByViewOrder,
  loadTable,
  type UndoRedoDbHarness,
} from '../../shared/undoRedoDbTestKit';

describe('undo-redo/createField (db)', () => {
  let harness: UndoRedoDbHarness | undefined;

  beforeEach(async () => {
    harness = await createUndoRedoDbHarness();
  });

  afterEach(async () => {
    await disposeHarness(harness);
    harness = undefined;
  });

  it('replays delete on undo and apply-field-snapshot on redo', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo Create Field');
    const titleField = findField(table, 'Title');
    const amountField = findField(table, 'Amount');
    const viewId = getViewId(table);
    const store = harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);
    const fieldId = `fld${'c'.repeat(16)}`;

    const record = await harness.execute<CreateRecordCommand, CreateRecordResult>(
      CreateRecordCommand.create({
        tableId: table.id().toString(),
        fields: {
          [titleField.id().toString()]: 'Alpha',
        },
      })._unsafeUnwrap()
    );

    const createFieldResult = await harness.execute<CreateFieldCommand, CreateFieldResult>(
      CreateFieldCommand.create({
        baseId: harness.testContainer.baseId.toString(),
        tableId: table.id().toString(),
        field: {
          id: fieldId,
          type: 'singleLineText',
          name: 'Notes',
        },
        order: {
          viewId,
          orderIndex: 0.5,
        },
      })._unsafeUnwrap()
    );

    const createdField = createFieldResult.table
      .getFields()
      .find((field) => field.id().toString() === fieldId);
    expect(createdField).toBeDefined();
    if (!createdField) return;
    const notesDbName = createdField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();

    const entry = (
      await store.list({
        actorId: harness.context.actorId,
        tableId: table.id(),
        windowId: harness.context.windowId!,
      })
    )
      ._unsafeUnwrap()
      .at(-1);

    expect(entry?.undoCommand.type).toBe('DeleteField');
    expect(entry?.redoCommand.type).toBe('ApplyFieldSnapshot');

    const createdRow = await fetchRowById(
      harness.db,
      createFieldResult.table,
      record.record.id().toString()
    );
    expect(listFieldIdsByViewOrder(createFieldResult.table, viewId)).toEqual([
      titleField.id().toString(),
      fieldId,
      amountField.id().toString(),
    ]);
    expect(createdRow).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(createdRow ?? {}, notesDbName)).toBe(true);

    await harness.undo(table.id().toString());
    expect(harness.probe.names()).toEqual(['UndoCommand', 'DeleteFieldCommand']);

    const undoneTable = await loadTable(harness, table);
    expect(undoneTable.getFields().some((field) => field.id().toString() === fieldId)).toBe(false);
    const undoneRow = await fetchRowById(harness.db, table, record.record.id().toString());
    expect(Object.prototype.hasOwnProperty.call(undoneRow ?? {}, notesDbName)).toBe(false);

    await harness.redo(table.id().toString());
    expect(harness.probe.names()).toEqual([
      'RedoCommand',
      'ApplyFieldSnapshotCommand',
      'CreateFieldCommand',
    ]);

    const redoneTable = await loadTable(harness, table);
    expect(redoneTable.getFields().some((field) => field.id().toString() === fieldId)).toBe(true);
    expect(listFieldIdsByViewOrder(redoneTable, viewId)).toEqual([
      titleField.id().toString(),
      fieldId,
      amountField.id().toString(),
    ]);
    const redoneRow = await fetchRowById(harness.db, redoneTable, record.record.id().toString());
    expect(Object.prototype.hasOwnProperty.call(redoneRow ?? {}, notesDbName)).toBe(true);
  });
});
