/* eslint-disable @typescript-eslint/naming-convention */
import {
  CreateRecordCommand,
  DuplicateFieldCommand,
  v2CoreTokens,
  type CreateRecordResult,
  type DuplicateFieldResult,
  type IUndoRedoStore,
} from '@teable/v2-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createBasicTable,
  createUndoRedoDbHarness,
  disposeHarness,
  fetchRowById,
  findField,
  loadTable,
  type UndoRedoDbHarness,
} from '../../shared/undoRedoDbTestKit';

describe('undo-redo/duplicateField (db)', () => {
  let harness: UndoRedoDbHarness | undefined;

  beforeEach(async () => {
    harness = await createUndoRedoDbHarness();
  });

  afterEach(async () => {
    await disposeHarness(harness);
    harness = undefined;
  });

  it('replays delete on undo and apply-field-snapshot on redo with duplicated values', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo Duplicate Field');
    const titleField = findField(table, 'Title');
    const amountField = findField(table, 'Amount');
    const store = harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);

    const record = await harness.execute<CreateRecordCommand, CreateRecordResult>(
      CreateRecordCommand.create({
        tableId: table.id().toString(),
        fields: {
          [titleField.id().toString()]: 'R1',
          [amountField.id().toString()]: 8,
        },
      })._unsafeUnwrap()
    );

    const duplicateResult = await harness.execute<DuplicateFieldCommand, DuplicateFieldResult>(
      DuplicateFieldCommand.create({
        baseId: harness.testContainer.baseId.toString(),
        tableId: table.id().toString(),
        fieldId: amountField.id().toString(),
        includeRecordValues: true,
        newFieldName: 'Amount Copy',
      })._unsafeUnwrap()
    );

    const duplicatedFieldId = duplicateResult.newField.id().toString();
    const duplicatedDbName = duplicateResult.newField
      .dbFieldName()
      ._unsafeUnwrap()
      .value()
      ._unsafeUnwrap();
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
    expect(
      (await fetchRowById(harness.db, duplicateResult.table, record.record.id().toString()))?.[
        duplicatedDbName
      ]
    ).toBe(8);

    await harness.undo(table.id().toString());
    expect(harness.probe.names()).toEqual(['UndoCommand', 'DeleteFieldCommand']);

    const undoneTable = await loadTable(harness, table);
    expect(
      undoneTable.getFields().some((field) => field.id().toString() === duplicatedFieldId)
    ).toBe(false);
    const undoneRow = await fetchRowById(harness.db, table, record.record.id().toString());
    expect(Object.prototype.hasOwnProperty.call(undoneRow ?? {}, duplicatedDbName)).toBe(false);

    await harness.redo(table.id().toString());
    expect(harness.probe.names()).toEqual([
      'RedoCommand',
      'ApplyFieldSnapshotCommand',
      'CreateFieldCommand',
    ]);

    const redoneTable = await loadTable(harness, table);
    expect(
      redoneTable.getFields().some((field) => field.id().toString() === duplicatedFieldId)
    ).toBe(true);
    const redoneRow = await fetchRowById(harness.db, redoneTable, record.record.id().toString());
    expect(redoneRow?.[duplicatedDbName]).toBe(8);
  });
});
