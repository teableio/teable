import {
  DuplicateRecordsStreamCommand,
  RecordWriteOperationKind,
  RecordsBatchCreated,
  domainError,
  type DomainError,
  type DuplicateRecordsStreamResult,
  type IRecordWritePlugin,
  v2CoreTokens,
} from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';
import {
  buildUndoRedoContext,
  createBasicTable,
  executeRedo,
  executeUndo,
  findFieldId,
  getCommandBus,
  getViewId,
} from '../../shared/undoRedoE2eTestKit';

const collectStreamEvents = async (stream: DuplicateRecordsStreamResult) => {
  const events = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
};

const listAllRecords = async (ctx: SharedTestContext, tableId: string) => {
  const records: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const pageSize = 500;

  for (let offset = 0; ; offset += pageSize) {
    const page = await ctx.listRecordsWithPagination(tableId, {
      limit: pageSize,
      offset,
    });
    records.push(...page.records);

    if (records.length >= page.pagination.total || page.records.length === 0) {
      break;
    }
  }

  return records;
};

const pluginOk = (): Awaited<ReturnType<NonNullable<IRecordWritePlugin['beforePersist']>>> =>
  ({
    isOk: () => true,
    isErr: () => false,
    value: undefined,
  }) as Awaited<ReturnType<NonNullable<IRecordWritePlugin['beforePersist']>>>;

const pluginErr = (
  error: DomainError
): Awaited<ReturnType<NonNullable<IRecordWritePlugin['beforePersist']>>> =>
  ({
    isOk: () => false,
    isErr: () => true,
    error,
  }) as Awaited<ReturnType<NonNullable<IRecordWritePlugin['beforePersist']>>>;

describe('undo-redo/duplicateRecordsStream (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('undoes large streamed duplication and redoes it', async () => {
    const table = await createBasicTable(ctx, 'Undo E2E DuplicateRecordsStream');
    const viewId = getViewId(table);
    const titleFieldId = findFieldId(table, 'Title');
    const amountFieldId = findFieldId(table, 'Amount');
    const totalRecords = 520;

    await ctx.createRecords(
      table.id,
      Array.from({ length: totalRecords }, (_, index) => ({
        fields: {
          [titleFieldId]: `Row ${index}`,
          [amountFieldId]: index,
        },
      }))
    );

    const streamResult = await getCommandBus(ctx).execute(
      buildUndoRedoContext(),
      DuplicateRecordsStreamCommand.create({
        tableId: table.id,
        viewId,
        type: 'rows',
        ranges: [[0, totalRecords - 1]],
        batchSize: 500,
      })._unsafeUnwrap()
    );
    expect(streamResult.isOk()).toBe(true);

    const events = await collectStreamEvents(streamResult._unsafeUnwrap());
    expect(events.at(-1)).toMatchObject({
      id: 'done',
      duplicatedCount: totalRecords,
    });
    expect(await listAllRecords(ctx, table.id)).toHaveLength(totalRecords * 2);

    await executeUndo(ctx, table.id);
    expect(await listAllRecords(ctx, table.id)).toHaveLength(totalRecords);

    await executeRedo(ctx, table.id);
    expect(await listAllRecords(ctx, table.id)).toHaveLength(totalRecords * 2);
  });

  it('commits successful duplicate chunks, preserves failed chunks, emits created events, and undoes only duplicated rows', async () => {
    const table = await createBasicTable(ctx, 'Undo E2E DuplicateRecordsStream Partial Failure');
    const viewId = getViewId(table);
    const titleFieldId = findFieldId(table, 'Title');
    const amountFieldId = findFieldId(table, 'Amount');
    const totalRecords = 1000;

    await ctx.createRecords(
      table.id,
      Array.from({ length: totalRecords }, (_, index) => ({
        fields: {
          [titleFieldId]: `Row ${index}`,
          [amountFieldId]: index,
        },
      }))
    );

    const plugins = ctx.testContainer.container.resolve<IRecordWritePlugin[]>(
      v2CoreTokens.recordWritePlugins
    );
    const failSecondChunkPlugin: IRecordWritePlugin = {
      name: `e2e-fail-second-stream-duplicate-${Date.now()}`,
      supports: (operation) => operation === RecordWriteOperationKind.duplicateStream,
      beforePersist: (context) => {
        if (
          context.kind === RecordWriteOperationKind.duplicateStream &&
          context.table.id().toString() === table.id &&
          context.orchestration?.mode === 'stream' &&
          context.orchestration.chunkIndex === 1
        ) {
          return pluginErr(domainError.unexpected({ message: 'second chunk failed' }));
        }
        return pluginOk();
      },
    };

    plugins.push(failSecondChunkPlugin);
    const eventCountBefore = ctx.testContainer.eventBus.events().length;

    try {
      const streamResult = await getCommandBus(ctx).execute(
        buildUndoRedoContext(),
        DuplicateRecordsStreamCommand.create({
          tableId: table.id,
          viewId,
          type: 'rows',
          ranges: [[0, totalRecords - 1]],
          batchSize: 500,
        })._unsafeUnwrap()
      );
      expect(streamResult.isOk()).toBe(true);

      const events = await collectStreamEvents(streamResult._unsafeUnwrap());
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

      const recordsAfterDuplicate = await listAllRecords(ctx, table.id);
      expect(recordsAfterDuplicate).toHaveLength(1500);

      const newEvents = ctx.testContainer.eventBus.events().slice(eventCountBefore);
      const recordsBatchCreatedEvents = newEvents.filter(
        (event): event is RecordsBatchCreated => event instanceof RecordsBatchCreated
      );
      expect(recordsBatchCreatedEvents).toHaveLength(1);
      expect(recordsBatchCreatedEvents[0]?.records).toHaveLength(500);

      await executeUndo(ctx, table.id);
      expect(await listAllRecords(ctx, table.id)).toHaveLength(totalRecords);
    } finally {
      const pluginIndex = plugins.findIndex((plugin) => plugin.name === failSecondChunkPlugin.name);
      if (pluginIndex >= 0) {
        plugins.splice(pluginIndex, 1);
      }
    }
  });
});
