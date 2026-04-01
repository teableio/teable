/* eslint-disable @typescript-eslint/naming-convention */
import {
  CreateFieldCommand,
  CreateRecordCommand,
  DeleteFieldsCommand,
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
  getFieldDbName,
  getViewId,
  listFieldIdsByViewOrder,
  loadTable,
  type UndoRedoDbHarness,
} from '../../shared/undoRedoDbTestKit';

describe('undo-redo/deleteFields (db)', () => {
  let harness: UndoRedoDbHarness | undefined;

  beforeEach(async () => {
    harness = await createUndoRedoDbHarness();
  });

  afterEach(async () => {
    await disposeHarness(harness);
    harness = undefined;
  });

  it('replays one batch undo/redo entry with original field snapshots for multi-field deletes', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo Delete Fields');
    const titleField = findField(table, 'Title');
    const amountField = findField(table, 'Amount');
    const amountDbName = getFieldDbName(table, 'Amount');
    const viewId = getViewId(table);
    const store = harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);

    const formulaFieldId = `fld${'f'.repeat(16)}`;
    await harness.execute<CreateFieldCommand, CreateFieldResult>(
      CreateFieldCommand.create({
        baseId: harness.testContainer.baseId.toString(),
        tableId: table.id().toString(),
        field: {
          id: formulaFieldId,
          type: 'formula',
          name: 'Amount Formula',
          options: {
            expression: `{${amountField.id().toString()}}`,
          },
        },
      })._unsafeUnwrap()
    );

    const record = await harness.execute<CreateRecordCommand, CreateRecordResult>(
      CreateRecordCommand.create({
        tableId: table.id().toString(),
        fields: {
          [titleField.id().toString()]: 'Alpha',
          [amountField.id().toString()]: 666,
        },
      })._unsafeUnwrap()
    );

    await harness.execute(
      DeleteFieldsCommand.create({
        baseId: harness.testContainer.baseId.toString(),
        tableId: table.id().toString(),
        fieldIds: [amountField.id().toString(), formulaFieldId],
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
    expect(entry?.undoCommand.type === 'Batch' ? entry.undoCommand.payload : []).toHaveLength(2);
    expect(entry?.redoCommand.type === 'Batch' ? entry.redoCommand.payload : []).toHaveLength(2);

    const deletedTable = await loadTable(harness, table);
    expect(listFieldIdsByViewOrder(deletedTable, viewId)).toEqual([titleField.id().toString()]);

    await harness.undo(table.id().toString());
    expect(harness.probe.names()).toEqual([
      'UndoCommand',
      'ApplyFieldSnapshotCommand',
      'CreateFieldCommand',
      'ApplyFieldSnapshotCommand',
      'CreateFieldCommand',
    ]);

    const undoneTable = await loadTable(harness, table);
    const formulaField = undoneTable
      .getFields()
      .find((field) => field.id().toString() === formulaFieldId);
    expect(listFieldIdsByViewOrder(undoneTable, viewId)).toEqual([
      titleField.id().toString(),
      amountField.id().toString(),
      formulaFieldId,
    ]);
    expect(formulaField?.hasError().toBoolean()).toBe(false);
    const undoneRow = await fetchRowById(harness.db, table, record.record.id().toString());
    expect(undoneRow?.[amountDbName]).toBe(666);

    await harness.redo(table.id().toString());
    expect(harness.probe.names()).toEqual([
      'RedoCommand',
      'DeleteFieldCommand',
      'DeleteFieldCommand',
    ]);

    const redoneTable = await loadTable(harness, table);
    expect(listFieldIdsByViewOrder(redoneTable, viewId)).toEqual([titleField.id().toString()]);
    const redoneRow = await fetchRowById(harness.db, table, record.record.id().toString());
    expect(Object.prototype.hasOwnProperty.call(redoneRow ?? {}, amountDbName)).toBe(false);
  });
});
