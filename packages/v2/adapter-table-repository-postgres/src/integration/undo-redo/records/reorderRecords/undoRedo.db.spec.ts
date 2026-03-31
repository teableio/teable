/* eslint-disable @typescript-eslint/naming-convention */
import {
  CreateRecordsCommand,
  ReorderRecordsCommand,
  type CreateRecordsResult,
  v2CoreTokens,
  type IUndoRedoStore,
} from '@teable/v2-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createBasicTable,
  createUndoRedoDbHarness,
  disposeHarness,
  findField,
  getViewId,
  listRowsByViewOrder,
  type UndoRedoDbHarness,
} from '../../shared/undoRedoDbTestKit';

describe('undo-redo/reorderRecords (db)', () => {
  let harness: UndoRedoDbHarness | undefined;

  beforeEach(async () => {
    harness = await createUndoRedoDbHarness();
  });

  afterEach(async () => {
    await disposeHarness(harness);
    harness = undefined;
  });

  it('replays apply-record-orders on undo and redo', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo Reorder Records');
    const viewId = getViewId(table);
    const titleField = findField(table, 'Title');
    const amountField = findField(table, 'Amount');
    const store = harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);

    const createResult = await harness.execute<CreateRecordsCommand, CreateRecordsResult>(
      CreateRecordsCommand.create({
        tableId: table.id().toString(),
        records: [
          { fields: { [titleField.id().toString()]: 'Alpha', [amountField.id().toString()]: 1 } },
          { fields: { [titleField.id().toString()]: 'Beta', [amountField.id().toString()]: 2 } },
          { fields: { [titleField.id().toString()]: 'Gamma', [amountField.id().toString()]: 3 } },
        ],
      })._unsafeUnwrap()
    );

    const alphaId = createResult.records[0]!.id().toString();
    const betaId = createResult.records[1]!.id().toString();
    const gammaId = createResult.records[2]!.id().toString();

    await harness.execute(
      ReorderRecordsCommand.create({
        tableId: table.id().toString(),
        recordIds: [gammaId],
        order: {
          viewId,
          anchorId: alphaId,
          position: 'before',
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

    expect(entry?.undoCommand.type).toBe('ApplyRecordOrders');
    expect(entry?.redoCommand.type).toBe('ApplyRecordOrders');
    expect((await listRowsByViewOrder(harness.db, table, viewId)).map((row) => row.__id)).toEqual([
      gammaId,
      alphaId,
      betaId,
    ]);

    await harness.undo(table.id().toString());
    expect(harness.probe.names()).toEqual(['UndoCommand', 'ApplyRecordOrdersCommand']);
    expect((await listRowsByViewOrder(harness.db, table, viewId)).map((row) => row.__id)).toEqual([
      alphaId,
      betaId,
      gammaId,
    ]);

    await harness.redo(table.id().toString());
    expect(harness.probe.names()).toEqual(['RedoCommand', 'ApplyRecordOrdersCommand']);
    expect((await listRowsByViewOrder(harness.db, table, viewId)).map((row) => row.__id)).toEqual([
      gammaId,
      alphaId,
      betaId,
    ]);
  });
});
