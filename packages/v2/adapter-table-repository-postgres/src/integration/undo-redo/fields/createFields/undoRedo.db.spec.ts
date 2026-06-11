/* eslint-disable @typescript-eslint/naming-convention */
import { CreateFieldsCommand, v2CoreTokens, type IUndoRedoStore } from '@teable/v2-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createBasicTable,
  createUndoRedoDbHarness,
  disposeHarness,
  findField,
  getViewId,
  listFieldIdsByViewOrder,
  loadTable,
  type UndoRedoDbHarness,
} from '../../shared/undoRedoDbTestKit';

describe('undo-redo/createFields (db)', () => {
  let harness: UndoRedoDbHarness | undefined;

  beforeEach(async () => {
    harness = await createUndoRedoDbHarness();
  });

  afterEach(async () => {
    await disposeHarness(harness);
    harness = undefined;
  });

  it('replays one batch undo/redo entry for same-table batch field creation with link side effects', async () => {
    if (!harness) {
      throw new Error('Missing harness');
    }

    const hostTable = await createBasicTable(harness, 'Undo Create Fields Host');
    const foreignTable = await createBasicTable(harness, 'Undo Create Fields Foreign');
    const titleField = findField(hostTable, 'Title');
    const amountField = findField(hostTable, 'Amount');
    const foreignTitleField = findField(foreignTable, 'Title');
    const viewId = getViewId(hostTable);
    const linkFieldId = `fld${'m'.repeat(16)}`;
    const lookupFieldId = `fld${'n'.repeat(16)}`;
    const store = harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);

    await harness.execute(
      CreateFieldsCommand.create({
        baseId: harness.testContainer.baseId.toString(),
        tableId: hostTable.id().toString(),
        fields: [
          {
            id: linkFieldId,
            type: 'link',
            name: 'Projects',
            options: {
              relationship: 'manyMany',
              foreignTableId: foreignTable.id().toString(),
              lookupFieldId: foreignTitleField.id().toString(),
            },
          },
          {
            id: lookupFieldId,
            type: 'lookup',
            name: 'Project Name',
            options: {
              linkFieldId,
              foreignTableId: foreignTable.id().toString(),
              lookupFieldId: foreignTitleField.id().toString(),
            },
          },
        ],
      })._unsafeUnwrap()
    );

    const entry = (
      await store.list({
        actorId: harness.context.actorId,
        tableId: hostTable.id(),
        windowId: harness.context.windowId!,
      })
    )
      ._unsafeUnwrap()
      .at(-1);

    expect(entry?.undoCommand.type).toBe('Batch');
    expect(entry?.redoCommand.type).toBe('Batch');
    expect(entry?.undoCommand.type === 'Batch' ? entry.undoCommand.payload : []).toHaveLength(2);
    expect(entry?.redoCommand.type === 'Batch' ? entry.redoCommand.payload : []).toHaveLength(2);

    const createdHostTable = await loadTable(harness, hostTable);
    const createdForeignTable = await loadTable(harness, foreignTable);
    expect(listFieldIdsByViewOrder(createdHostTable, viewId)).toEqual([
      titleField.id().toString(),
      amountField.id().toString(),
      linkFieldId,
      lookupFieldId,
    ]);
    expect(
      createdForeignTable.getFields().filter((field) => field.type().toString() === 'link')
    ).toHaveLength(1);

    await harness.undo(hostTable.id().toString());
    expect(harness.probe.names()).toEqual([
      'UndoCommand',
      'DeleteFieldCommand',
      'DeleteFieldCommand',
    ]);

    const undoneHostTable = await loadTable(harness, hostTable);
    const undoneForeignTable = await loadTable(harness, foreignTable);
    expect(listFieldIdsByViewOrder(undoneHostTable, viewId)).toEqual([
      titleField.id().toString(),
      amountField.id().toString(),
    ]);
    expect(
      undoneForeignTable.getFields().filter((field) => field.type().toString() === 'link')
    ).toHaveLength(0);

    await harness.redo(hostTable.id().toString());
    expect(harness.probe.names()).toEqual([
      'RedoCommand',
      'ApplyFieldSnapshotCommand',
      'CreateFieldCommand',
      'ApplyFieldSnapshotCommand',
      'CreateFieldCommand',
    ]);

    const redoneHostTable = await loadTable(harness, hostTable);
    const redoneForeignTable = await loadTable(harness, foreignTable);
    expect(listFieldIdsByViewOrder(redoneHostTable, viewId)).toEqual([
      titleField.id().toString(),
      amountField.id().toString(),
      linkFieldId,
      lookupFieldId,
    ]);
    expect(
      redoneForeignTable.getFields().filter((field) => field.type().toString() === 'link')
    ).toHaveLength(1);
  });
});
