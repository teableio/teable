/* eslint-disable @typescript-eslint/naming-convention */
import {
  CreateRecordsCommand,
  DeleteByRangeCommand,
  DeleteByRangeStreamCommand,
  RECORD_REMOVAL_REASON,
  RecordsDeleted,
  RecordWriteOperationKind,
  RestoreRecordsCommand,
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
    harness = await createUndoRedoDbHarness({
      tableDataSafetyLimits: {
        recordValues: { maxRecordsPerMutation: 2_000 },
      },
    });
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

  it('restores all streamed delete chunks when only the last chunk has landed in record_trash', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo DeleteByRange Stream Partial RecordTrash');
    const viewId = getViewId(table);
    const titleField = findField(table, 'Title');
    const amountField = findField(table, 'Amount');
    const tableId = table.id().toString();
    const totalRecords = 15;

    const createResult = await harness.execute<CreateRecordsCommand, CreateRecordsResult>(
      CreateRecordsCommand.create({
        tableId,
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
        tableId,
        viewId,
        type: 'rows',
        ranges: [[0, totalRecords - 1]],
        batchSize: 5,
      })._unsafeUnwrap()
    );
    await collectStreamEvents(stream);
    expect(await listRows(harness.db, table)).toHaveLength(0);

    const tableTrashBefore = await harness.db
      .selectFrom('table_trash')
      .select(['id', 'snapshot'])
      .where('table_id', '=', tableId)
      .where('resource_type', '=', 'record')
      .execute();
    expect(tableTrashBefore).toHaveLength(1);

    // Simulate async V2RecordsDeletedTableTrashProjection having landed ONLY for
    // the last chunk (the first chunk undo replays) while earlier chunks are still
    // only tracked in the shared table_trash row.
    const lastChunkIds = createResult.records.slice(10, 15).map((record) => record.id().toString());
    const actorId = harness.context.actorId.toString();
    const tableTrashId = tableTrashBefore[0]?.id as string;
    expect(tableTrashId).toBeTruthy();
    const createdTime = new Date();
    await harness.db
      .insertInto('record_trash')
      .values(
        lastChunkIds.map((recordId, index) => ({
          id: `rtrLastChunk00000${index}`,
          table_id: tableId,
          record_id: recordId,
          snapshot: JSON.stringify({ id: recordId }),
          created_by: actorId,
          created_time: createdTime,
          reason: RECORD_REMOVAL_REASON.Deleted,
          operation_id: tableTrashId,
        }))
      )
      .execute();

    await harness.undo(tableId);

    expect(await listRows(harness.db, table)).toHaveLength(totalRecords);
    const remainingRecordTrash = await harness.db
      .selectFrom('record_trash')
      .select('id')
      .where('table_id', '=', tableId)
      .execute();
    const remainingTableTrash = await harness.db
      .selectFrom('table_trash')
      .select('id')
      .where('table_id', '=', tableId)
      .where('resource_type', '=', 'record')
      .execute();
    expect(remainingRecordTrash).toHaveLength(0);
    expect(remainingTableTrash).toHaveLength(0);
  });

  it('shrinks table_trash snapshot per restored chunk even when sibling chunks exist in record_trash', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo DeleteByRange Stream Shrink Snapshot');
    const viewId = getViewId(table);
    const titleField = findField(table, 'Title');
    const amountField = findField(table, 'Amount');
    const tableId = table.id().toString();
    const totalRecords = 10;

    const createResult = await harness.execute<CreateRecordsCommand, CreateRecordsResult>(
      CreateRecordsCommand.create({
        tableId,
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
        tableId,
        viewId,
        type: 'rows',
        ranges: [[0, totalRecords - 1]],
        batchSize: 5,
      })._unsafeUnwrap()
    );
    await collectStreamEvents(stream);

    const tableTrashRow = await harness.db
      .selectFrom('table_trash')
      .select(['id', 'snapshot'])
      .where('table_id', '=', tableId)
      .where('resource_type', '=', 'record')
      .executeTakeFirstOrThrow();

    const firstChunkIds = createResult.records.slice(0, 5).map((record) => record.id().toString());
    const secondChunkIds = createResult.records
      .slice(5, 10)
      .map((record) => record.id().toString());
    const actorId = harness.context.actorId.toString();
    const createdTime = new Date();
    await harness.db
      .insertInto('record_trash')
      .values(
        [...firstChunkIds, ...secondChunkIds].map((recordId, index) => ({
          id: `rtrBothChunks000${index}`,
          table_id: tableId,
          record_id: recordId,
          snapshot: JSON.stringify({ id: recordId }),
          created_by: actorId,
          created_time: createdTime,
          reason: RECORD_REMOVAL_REASON.Deleted,
          operation_id: tableTrashRow.id as string,
        }))
      )
      .execute();

    await harness.execute(
      RestoreRecordsCommand.create(
        {
          tableId,
          records: secondChunkIds.map((recordId, index) => ({
            recordId,
            fields: {
              [titleField.id().toString()]: `Row ${index + 5}`,
              [amountField.id().toString()]: index + 5,
            },
          })),
        },
        { requireTrashRowReason: RECORD_REMOVAL_REASON.Deleted }
      )._unsafeUnwrap()
    );

    const tableTrashAfterFirstRestore = await harness.db
      .selectFrom('table_trash')
      .select(['id', 'snapshot'])
      .where('id', '=', tableTrashRow.id as string)
      .executeTakeFirstOrThrow();
    const remainingSnapshotIds = JSON.parse(
      tableTrashAfterFirstRestore.snapshot as string
    ) as string[];
    expect(remainingSnapshotIds.sort()).toEqual([...firstChunkIds].sort());

    const remainingRecordTrashIds = (
      await harness.db
        .selectFrom('record_trash')
        .select('record_id')
        .where('table_id', '=', tableId)
        .execute()
    ).map((row) => row.record_id as string);
    expect(remainingRecordTrashIds.sort()).toEqual([...firstChunkIds].sort());
  });
});
