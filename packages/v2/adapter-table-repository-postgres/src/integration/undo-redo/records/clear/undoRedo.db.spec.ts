/* eslint-disable @typescript-eslint/naming-convention */
import {
  ClearCommand,
  CreateRecordsCommand,
  type CreateRecordsResult,
  v2CoreTokens,
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
  type UndoRedoDbHarness,
} from '../../shared/undoRedoDbTestKit';

describe('undo-redo/clear (db)', () => {
  let harness: UndoRedoDbHarness | undefined;

  beforeEach(async () => {
    harness = await createUndoRedoDbHarness();
  });

  afterEach(async () => {
    await disposeHarness(harness);
    harness = undefined;
  });

  it('replays update batches on undo and redo', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo Clear');
    const viewId = getViewId(table);
    const titleField = findField(table, 'Title');
    const amountField = findField(table, 'Amount');
    const amountDbName = getFieldDbName(table, 'Amount');
    const store = harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);

    const createResult = await harness.execute<CreateRecordsCommand, CreateRecordsResult>(
      CreateRecordsCommand.create({
        tableId: table.id().toString(),
        records: [
          {
            fields: {
              [titleField.id().toString()]: 'Alpha',
              [amountField.id().toString()]: 11,
            },
          },
          {
            fields: {
              [titleField.id().toString()]: 'Beta',
              [amountField.id().toString()]: 22,
            },
          },
        ],
      })._unsafeUnwrap()
    );

    await harness.execute(
      ClearCommand.create({
        tableId: table.id().toString(),
        viewId,
        ranges: [
          [1, 0],
          [1, 1],
        ],
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

    expect(entry?.undoCommand.type).toBe('UpdateRecords');
    expect(entry?.redoCommand.type).toBe('UpdateRecords');
    expect(
      (await fetchRowById(harness.db, table, createResult.records[0]!.id().toString()))?.[
        amountDbName
      ]
    ).toBe(null);
    expect(
      (await fetchRowById(harness.db, table, createResult.records[1]!.id().toString()))?.[
        amountDbName
      ]
    ).toBe(null);

    await harness.undo(table.id().toString());
    expect(harness.probe.names()[0]).toBe('UndoCommand');
    expect(harness.probe.names().filter((name) => name === 'UpdateRecordsCommand')).toHaveLength(1);
    expect(
      (await fetchRowById(harness.db, table, createResult.records[0]!.id().toString()))?.[
        amountDbName
      ]
    ).toBe(11);
    expect(
      (await fetchRowById(harness.db, table, createResult.records[1]!.id().toString()))?.[
        amountDbName
      ]
    ).toBe(22);

    await harness.redo(table.id().toString());
    expect(harness.probe.names()[0]).toBe('RedoCommand');
    expect(harness.probe.names().filter((name) => name === 'UpdateRecordsCommand')).toHaveLength(1);
    expect(
      (await fetchRowById(harness.db, table, createResult.records[0]!.id().toString()))?.[
        amountDbName
      ]
    ).toBe(null);
    expect(
      (await fetchRowById(harness.db, table, createResult.records[1]!.id().toString()))?.[
        amountDbName
      ]
    ).toBe(null);
  });
});
