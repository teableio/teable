/* eslint-disable @typescript-eslint/naming-convention */
import {
  CreateRecordsCommand,
  DeleteByRangeCommand,
  DeleteByRangeStreamCommand,
  RecordsDeleted,
  RecordWriteOperationKind,
  domainError,
  type CreateRecordsResult,
  type DeleteByRangeStreamResult,
  type IRecordWritePlugin,
  v2CoreTokens,
  type IUndoRedoStore,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createBasicTable,
  createUndoRedoDbHarness,
  disposeHarness,
  fetchRowById,
  findField,
  getViewId,
  listRows,
  type UndoRedoDbHarness,
} from '../../shared/undoRedoDbTestKit';

const collectStreamEvents = async (stream: DeleteByRangeStreamResult) => {
  const events = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
};

describe('undo-redo/deleteByRange (db)', () => {
  let harness: UndoRedoDbHarness | undefined;

  beforeEach(async () => {
    harness = await createUndoRedoDbHarness();
  });

  afterEach(async () => {
    await disposeHarness(harness);
    harness = undefined;
  });

  it('replays restore on undo and delete on redo for ranged row deletion', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo DeleteByRange');
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

    const deletedId = createResult.records[1]!.id().toString();

    await harness.execute(
      DeleteByRangeCommand.create({
        tableId: table.id().toString(),
        viewId,
        type: 'rows',
        ranges: [[1, 1]],
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

    expect(entry?.undoCommand.type).toBe('RestoreRecords');
    expect(entry?.redoCommand.type).toBe('DeleteRecords');
    expect(await fetchRowById(harness.db, table, deletedId)).toBeUndefined();

    await harness.undo(table.id().toString());
    expect(harness.probe.names()).toEqual(['UndoCommand', 'RestoreRecordsCommand']);
    expect(await fetchRowById(harness.db, table, deletedId)).toBeDefined();

    await harness.redo(table.id().toString());
    expect(harness.probe.names()).toEqual(['RedoCommand', 'DeleteRecordsCommand']);
    expect(await fetchRowById(harness.db, table, deletedId)).toBeUndefined();
  });

  it('undoes large ranged deletion by restoring records across internal batches', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo DeleteByRange Large Batch');
    const viewId = getViewId(table);
    const titleField = findField(table, 'Title');
    const amountField = findField(table, 'Amount');

    const totalRecords = 1001;
    const createResult = await harness.execute<CreateRecordsCommand, CreateRecordsResult>(
      CreateRecordsCommand.create({
        tableId: table.id().toString(),
        records: Array.from({ length: totalRecords }, (_, index) => ({
          fields: {
            [titleField.id().toString()]: `Row ${index}`,
            [amountField.id().toString()]: index,
          },
        })),
      })._unsafeUnwrap()
    );

    await harness.execute(
      DeleteByRangeCommand.create({
        tableId: table.id().toString(),
        viewId,
        type: 'rows',
        ranges: [[0, totalRecords - 1]],
      })._unsafeUnwrap()
    );

    expect(await listRows(harness.db, table)).toHaveLength(0);

    await harness.undo(table.id().toString());
    expect(harness.probe.names()).toEqual(['UndoCommand', 'RestoreRecordsCommand']);
    expect(await listRows(harness.db, table)).toHaveLength(totalRecords);
    expect(
      await fetchRowById(harness.db, table, createResult.records[0]!.id().toString())
    ).toBeDefined();
    expect(
      await fetchRowById(harness.db, table, createResult.records[totalRecords - 1]!.id().toString())
    ).toBeDefined();
  });

  it('stores streamed delete undo as grouped chunk entries and replays restore per chunk', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo DeleteByRange Stream Grouped');
    const viewId = getViewId(table);
    const titleField = findField(table, 'Title');
    const amountField = findField(table, 'Amount');
    const store = harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);
    const totalRecords = 1000;

    const createResult = await harness.execute<CreateRecordsCommand, CreateRecordsResult>(
      CreateRecordsCommand.create({
        tableId: table.id().toString(),
        records: Array.from({ length: totalRecords }, (_, index) => ({
          fields: {
            [titleField.id().toString()]: `Row ${index}`,
            [amountField.id().toString()]: index,
          },
        })),
      })._unsafeUnwrap()
    );

    const stream = await harness.execute<DeleteByRangeStreamCommand, DeleteByRangeStreamResult>(
      DeleteByRangeStreamCommand.create({
        tableId: table.id().toString(),
        viewId,
        type: 'rows',
        ranges: [[0, totalRecords - 1]],
        batchSize: 500,
      })._unsafeUnwrap()
    );
    const events = await collectStreamEvents(stream);

    expect(events.at(-1)).toMatchObject({
      id: 'done',
      deletedCount: totalRecords,
      totalCount: totalRecords,
    });
    expect(await listRows(harness.db, table)).toHaveLength(0);

    const entries = (
      await store.list({
        actorId: harness.context.actorId,
        tableId: table.id(),
        windowId: harness.context.windowId!,
      })
    )
      ._unsafeUnwrap()
      .slice(-2);

    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((entry) => entry.groupId))).toEqual(new Set([entries[0]?.groupId]));
    expect(entries.every((entry) => entry.undoCommand.type === 'RestoreRecords')).toBe(true);
    expect(entries.every((entry) => entry.redoCommand.type === 'DeleteRecords')).toBe(true);

    await harness.undo(table.id().toString());
    expect(harness.probe.names()[0]).toBe('UndoCommand');
    expect(harness.probe.names().filter((name) => name === 'RestoreRecordsCommand')).toHaveLength(
      2
    );
    expect(await listRows(harness.db, table)).toHaveLength(totalRecords);

    await harness.redo(table.id().toString());
    expect(harness.probe.names()[0]).toBe('RedoCommand');
    expect(harness.probe.names().filter((name) => name === 'DeleteRecordsCommand')).toHaveLength(2);
    expect(await listRows(harness.db, table)).toHaveLength(0);
    expect(
      await fetchRowById(harness.db, table, createResult.records[0]!.id().toString())
    ).toBeUndefined();
  });

  it('commits successful streamed chunks, preserves failed chunks, and records undo only for deleted rows', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo DeleteByRange Stream Partial Failure');
    const viewId = getViewId(table);
    const titleField = findField(table, 'Title');
    const amountField = findField(table, 'Amount');
    const store = harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);
    const plugins = harness.container.resolve<IRecordWritePlugin[]>(
      v2CoreTokens.recordWritePlugins
    );

    const totalRecords = 1000;
    const createResult = await harness.execute<CreateRecordsCommand, CreateRecordsResult>(
      CreateRecordsCommand.create({
        tableId: table.id().toString(),
        records: Array.from({ length: totalRecords }, (_, index) => ({
          fields: {
            [titleField.id().toString()]: `Row ${index}`,
            [amountField.id().toString()]: index,
          },
        })),
      })._unsafeUnwrap()
    );

    const failSecondChunkPlugin: IRecordWritePlugin = {
      name: `fail-second-stream-delete-${Date.now()}`,
      supports: (operation) => operation === RecordWriteOperationKind.deleteMany,
      beforePersist: (context) => {
        if (
          context.kind === RecordWriteOperationKind.deleteMany &&
          context.table.id().equals(table.id()) &&
          context.orchestration?.mode === 'stream' &&
          context.orchestration.chunkIndex === 1
        ) {
          return err(domainError.unexpected({ message: 'second chunk failed' }));
        }
        return ok(undefined);
      },
    };

    plugins.push(failSecondChunkPlugin);

    const eventCountBefore = harness.testContainer.eventBus.events().length;

    try {
      const stream = await harness.execute<DeleteByRangeStreamCommand, DeleteByRangeStreamResult>(
        DeleteByRangeStreamCommand.create({
          tableId: table.id().toString(),
          viewId,
          type: 'rows',
          ranges: [[0, totalRecords - 1]],
          batchSize: 500,
        })._unsafeUnwrap()
      );

      const events = await collectStreamEvents(stream);

      expect(events.find((event) => event.id === 'error')).toMatchObject({
        id: 'error',
        phase: 'deleting',
        batchIndex: 1,
        totalCount: totalRecords,
        deletedCount: 500,
        message: 'second chunk failed',
      });
      expect(events.at(-1)).toMatchObject({
        id: 'done',
        totalCount: totalRecords,
        deletedCount: 500,
        data: {
          deletedCount: 500,
        },
      });

      for (const record of createResult.records.slice(0, 500)) {
        expect(await fetchRowById(harness.db, table, record.id().toString())).toBeUndefined();
      }
      for (const record of createResult.records.slice(500)) {
        expect(await fetchRowById(harness.db, table, record.id().toString())).toBeDefined();
      }

      const undoEntry = (
        await store.list({
          actorId: harness.context.actorId,
          tableId: table.id(),
          windowId: harness.context.windowId!,
        })
      )
        ._unsafeUnwrap()
        .at(-1);

      expect(undoEntry?.undoCommand.type).toBe('RestoreRecords');
      expect(
        (
          undoEntry as {
            undoCommand: { payload: { records: Array<{ recordId: string }> } };
          }
        ).undoCommand.payload.records
      ).toHaveLength(500);

      const newEvents = harness.testContainer.eventBus.events().slice(eventCountBefore);
      const recordsDeletedEvents = newEvents.filter(
        (event): event is RecordsDeleted => event instanceof RecordsDeleted
      );
      expect(recordsDeletedEvents).toHaveLength(1);
      expect(recordsDeletedEvents[0]?.recordIds).toHaveLength(500);

      await harness.undo(table.id().toString());
      expect(await listRows(harness.db, table)).toHaveLength(totalRecords);
      expect(
        await fetchRowById(harness.db, table, createResult.records[0]!.id().toString())
      ).toBeDefined();
      expect(
        await fetchRowById(harness.db, table, createResult.records[999]!.id().toString())
      ).toBeDefined();
    } finally {
      const pluginIndex = plugins.findIndex((plugin) => plugin.name === failSecondChunkPlugin.name);
      if (pluginIndex >= 0) {
        plugins.splice(pluginIndex, 1);
      }
    }
  });
});
