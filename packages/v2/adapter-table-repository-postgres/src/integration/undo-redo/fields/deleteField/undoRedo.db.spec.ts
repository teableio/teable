/* eslint-disable @typescript-eslint/naming-convention */
import {
  CreateFieldCommand,
  CreateRecordCommand,
  DeleteFieldCommand,
  v2CoreTokens,
  type CreateFieldResult,
  type CreateRecordResult,
  type DeleteFieldResult,
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

describe('undo-redo/deleteField (db)', () => {
  let harness: UndoRedoDbHarness | undefined;

  beforeEach(async () => {
    harness = await createUndoRedoDbHarness();
  });

  afterEach(async () => {
    await disposeHarness(harness);
    harness = undefined;
  });

  it('replays apply-field-snapshot on undo and delete on redo with record values restored', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo Delete Field');
    const titleField = findField(table, 'Title');
    const amountField = findField(table, 'Amount');
    const amountDbName = getFieldDbName(table, 'Amount');
    const viewId = getViewId(table);
    const store = harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);

    const record = await harness.execute<CreateRecordCommand, CreateRecordResult>(
      CreateRecordCommand.create({
        tableId: table.id().toString(),
        fields: {
          [titleField.id().toString()]: 'Alpha',
          [amountField.id().toString()]: 42,
        },
      })._unsafeUnwrap()
    );

    await harness.execute<DeleteFieldCommand, DeleteFieldResult>(
      DeleteFieldCommand.create({
        baseId: harness.testContainer.baseId.toString(),
        tableId: table.id().toString(),
        fieldId: amountField.id().toString(),
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

    expect(entry?.undoCommand.type).toBe('ApplyFieldSnapshot');
    expect(entry?.redoCommand.type).toBe('DeleteField');

    const deletedTable = await loadTable(harness, table);
    expect(deletedTable.getFields().some((field) => field.id().equals(amountField.id()))).toBe(
      false
    );
    const deletedRow = await fetchRowById(harness.db, table, record.record.id().toString());
    expect(Object.prototype.hasOwnProperty.call(deletedRow ?? {}, amountDbName)).toBe(false);

    await harness.undo(table.id().toString());
    expect(harness.probe.names()).toEqual([
      'UndoCommand',
      'ApplyFieldSnapshotCommand',
      'CreateFieldCommand',
    ]);

    const undoneTable = await loadTable(harness, table);
    expect(undoneTable.getFields().some((field) => field.id().equals(amountField.id()))).toBe(true);
    expect(listFieldIdsByViewOrder(undoneTable, viewId)).toEqual([
      titleField.id().toString(),
      amountField.id().toString(),
    ]);
    const undoneRow = await fetchRowById(harness.db, undoneTable, record.record.id().toString());
    expect(undoneRow?.[amountDbName]).toBe(42);

    await harness.redo(table.id().toString());
    expect(harness.probe.names()).toEqual(['RedoCommand', 'DeleteFieldCommand']);

    const redoneTable = await loadTable(harness, table);
    expect(redoneTable.getFields().some((field) => field.id().equals(amountField.id()))).toBe(
      false
    );
    const redoneRow = await fetchRowById(harness.db, table, record.record.id().toString());
    expect(Object.prototype.hasOwnProperty.call(redoneRow ?? {}, amountDbName)).toBe(false);
  });

  it('restores dependent formula field error state when undoing a delete', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo Delete Field References');
    const titleField = findField(table, 'Title');
    const amountField = findField(table, 'Amount');

    const formulaTable = await harness.execute<CreateFieldCommand, CreateFieldResult>(
      CreateFieldCommand.create({
        baseId: harness.testContainer.baseId.toString(),
        tableId: table.id().toString(),
        field: {
          id: `fld${'f'.repeat(16)}`,
          type: 'formula',
          name: 'Amount Formula',
          options: {
            expression: `{${amountField.id().toString()}}`,
          },
        },
      })._unsafeUnwrap()
    );
    const formulaFieldId = formulaTable.table
      .getFields()
      .find((field) => field.name().toString() === 'Amount Formula')
      ?.id()
      .toString();
    expect(formulaFieldId).toBeDefined();
    if (!formulaFieldId) return;

    await harness.execute<CreateRecordCommand, CreateRecordResult>(
      CreateRecordCommand.create({
        tableId: table.id().toString(),
        fields: {
          [titleField.id().toString()]: 'Alpha',
          [amountField.id().toString()]: 42,
        },
      })._unsafeUnwrap()
    );

    await harness.execute<DeleteFieldCommand, DeleteFieldResult>(
      DeleteFieldCommand.create({
        baseId: harness.testContainer.baseId.toString(),
        tableId: table.id().toString(),
        fieldId: amountField.id().toString(),
      })._unsafeUnwrap()
    );

    let deletedTable = await loadTable(harness, table);
    let deletedFormulaField = deletedTable
      .getFields()
      .find((field) => field.id().toString() === formulaFieldId);
    expect(deletedFormulaField?.hasError().toBoolean()).toBe(true);

    await harness.undo(table.id().toString());

    const undoCommands = harness.probe.names();
    expect(undoCommands).toContain('ApplyFieldSnapshotCommand');
    expect(undoCommands.filter((name) => name === 'ApplyFieldSnapshotCommand')).toHaveLength(2);

    deletedTable = await loadTable(harness, table);
    deletedFormulaField = deletedTable
      .getFields()
      .find((field) => field.id().toString() === formulaFieldId);
    expect(deletedFormulaField?.hasError().toBoolean()).toBe(false);
  });
});
