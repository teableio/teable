/* eslint-disable @typescript-eslint/naming-convention */
import {
  CreateRecordsCommand,
  DuplicateRecordsStreamCommand,
  RecordWriteOperationKind,
  RecordsBatchCreated,
  domainError,
  type CreateRecordsResult,
  type DuplicateRecordsStreamResult,
  type IRecordWritePlugin,
  type IUndoRedoStore,
  v2CoreTokens,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createBasicTable,
  createUndoRedoDbHarness,
  disposeHarness,
  findField,
  getViewId,
  listRows,
  type UndoRedoDbHarness,
} from '../../shared/undoRedoDbTestKit';

const collectStreamEvents = async (stream: DuplicateRecordsStreamResult) => {
  const events = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
};

describe('undo-redo/duplicateRecordsStream (db)', () => {
  let harness: UndoRedoDbHarness | undefined;

  beforeEach(async () => {
    harness = await createUndoRedoDbHarness();
  });

  afterEach(async () => {
    await disposeHarness(harness);
    harness = undefined;
  });

  it('undoes large streamed duplication with batched delete commands and redoes via restore', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo DuplicateRecordsStream Large Batch');
    const viewId = getViewId(table);
    const titleField = findField(table, 'Title');
    const amountField = findField(table, 'Amount');
    const store = harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);
    const totalRecords = 1000;

    await harness.execute<CreateRecordsCommand, CreateRecordsResult>(
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

    const stream = await harness.execute<
      DuplicateRecordsStreamCommand,
      DuplicateRecordsStreamResult
    >(
      DuplicateRecordsStreamCommand.create({
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
      duplicatedCount: totalRecords,
      totalCount: totalRecords,
    });
    expect(await listRows(harness.db, table)).toHaveLength(totalRecords * 2);

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
    expect(entries.every((entry) => entry.undoCommand.type === 'DeleteRecords')).toBe(true);
    expect(entries.every((entry) => entry.redoCommand.type === 'RestoreRecords')).toBe(true);

    await harness.undo(table.id().toString());
    expect(harness.probe.names()[0]).toBe('UndoCommand');
    expect(harness.probe.names().filter((name) => name === 'DeleteRecordsCommand')).toHaveLength(2);
    expect(await listRows(harness.db, table)).toHaveLength(totalRecords);

    await harness.redo(table.id().toString());
    expect(harness.probe.names()[0]).toBe('RedoCommand');
    expect(harness.probe.names().filter((name) => name === 'RestoreRecordsCommand')).toHaveLength(
      2
    );
    expect(await listRows(harness.db, table)).toHaveLength(totalRecords * 2);
  });

  it('commits successful duplicate chunks, preserves failures, publishes created events, and undoes only duplicated rows', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo DuplicateRecordsStream Partial Failure');
    const viewId = getViewId(table);
    const titleField = findField(table, 'Title');
    const amountField = findField(table, 'Amount');
    const plugins = harness.container.resolve<IRecordWritePlugin[]>(
      v2CoreTokens.recordWritePlugins
    );
    const totalRecords = 1000;

    await harness.execute<CreateRecordsCommand, CreateRecordsResult>(
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
      name: `fail-second-stream-duplicate-${Date.now()}`,
      supports: (operation) => operation === RecordWriteOperationKind.duplicateStream,
      beforePersist: (context) => {
        if (
          context.kind === RecordWriteOperationKind.duplicateStream &&
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
      const stream = await harness.execute<
        DuplicateRecordsStreamCommand,
        DuplicateRecordsStreamResult
      >(
        DuplicateRecordsStreamCommand.create({
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
        phase: 'duplicating',
        batchIndex: 1,
        totalCount: totalRecords,
        duplicatedCount: 500,
        message: 'second chunk failed',
      });
      expect(events.at(-1)).toMatchObject({
        id: 'done',
        totalCount: totalRecords,
        duplicatedCount: 500,
      });

      expect(await listRows(harness.db, table)).toHaveLength(1500);

      const newEvents = harness.testContainer.eventBus.events().slice(eventCountBefore);
      const recordsBatchCreatedEvents = newEvents.filter(
        (event): event is RecordsBatchCreated => event instanceof RecordsBatchCreated
      );
      expect(recordsBatchCreatedEvents).toHaveLength(1);
      expect(recordsBatchCreatedEvents[0]?.records).toHaveLength(500);

      await harness.undo(table.id().toString());
      expect(harness.probe.names()[0]).toBe('UndoCommand');
      expect(harness.probe.names().filter((name) => name === 'DeleteRecordsCommand')).toHaveLength(
        1
      );
      expect(await listRows(harness.db, table)).toHaveLength(totalRecords);
    } finally {
      const pluginIndex = plugins.findIndex((plugin) => plugin.name === failSecondChunkPlugin.name);
      if (pluginIndex >= 0) {
        plugins.splice(pluginIndex, 1);
      }
    }
  });
});
