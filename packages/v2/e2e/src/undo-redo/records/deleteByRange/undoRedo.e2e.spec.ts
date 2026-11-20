import {
  DeleteByRangeStreamCommand,
  type DomainError,
  RecordsDeleted,
  RecordWriteOperationKind,
  domainError,
  type DeleteByRangeStreamResult,
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

const collectStreamEvents = async (stream: DeleteByRangeStreamResult) => {
  const events = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
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

describe('undo-redo/deleteByRange (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('undoes ranged row deletion and redoes it', async () => {
    const table = await createBasicTable(ctx, 'Undo E2E DeleteByRange');
    const viewId = getViewId(table);
    const titleFieldId = findFieldId(table, 'Title');
    const amountFieldId = findFieldId(table, 'Amount');
    const records = await ctx.createRecords(table.id, [
      { fields: { [titleFieldId]: 'Alpha', [amountFieldId]: 1 } },
      { fields: { [titleFieldId]: 'Beta', [amountFieldId]: 2 } },
      { fields: { [titleFieldId]: 'Gamma', [amountFieldId]: 3 } },
    ]);

    await ctx.deleteByRange({
      tableId: table.id,
      viewId,
      type: 'rows',
      ranges: [[1, 1]],
    });
    expect(
      (await ctx.listRecords(table.id)).find((item) => item.id === records[1]!.id)
    ).toBeUndefined();

    await executeUndo(ctx, table.id);
    expect(
      (await ctx.listRecords(table.id)).find((item) => item.id === records[1]!.id)?.fields[
        amountFieldId
      ]
    ).toBe(2);

    await executeRedo(ctx, table.id);
    expect(
      (await ctx.listRecords(table.id)).find((item) => item.id === records[1]!.id)
    ).toBeUndefined();
  });

  it('undoes large ranged deletion when restore needs multiple internal batches', async () => {
    const table = await createBasicTable(ctx, 'Undo E2E DeleteByRange Large Batch');
    const viewId = getViewId(table);
    const titleFieldId = findFieldId(table, 'Title');
    const amountFieldId = findFieldId(table, 'Amount');
    const totalRecords = 520;

    const records = await ctx.createRecords(
      table.id,
      Array.from({ length: totalRecords }, (_, index) => ({
        fields: {
          [titleFieldId]: `Row ${index}`,
          [amountFieldId]: index,
        },
      }))
    );

    await ctx.deleteByRange({
      tableId: table.id,
      viewId,
      type: 'rows',
      ranges: [[0, totalRecords - 1]],
    });
    expect(await ctx.listRecords(table.id)).toHaveLength(0);

    await executeUndo(ctx, table.id);
    const restored = await ctx.listRecords(table.id, { limit: totalRecords });
    expect(restored).toHaveLength(totalRecords);
    expect(restored.find((item) => item.id === records[0]!.id)?.fields[amountFieldId]).toBe(0);
    expect(
      restored.find((item) => item.id === records[totalRecords - 1]!.id)?.fields[amountFieldId]
    ).toBe(totalRecords - 1);
  });

  it('restores link-backed lookup and formula values after undoing ranged deletion', async () => {
    const sourceTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo E2E DeleteByRange Link Source',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const sourceNameFieldId = findFieldId(sourceTable, 'Name');
    const sourceRecord = await ctx.createRecord(sourceTable.id, {
      [sourceNameFieldId]: 'Source A',
    });

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo E2E DeleteByRange Link Host',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });

    const hostWithLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTable.id,
      field: {
        type: 'link',
        name: 'Source Link',
        options: {
          relationship: 'manyOne',
          foreignTableId: sourceTable.id,
          lookupFieldId: sourceNameFieldId,
        },
      },
    });
    const linkFieldId = findFieldId(hostWithLink, 'Source Link');

    const hostWithLookup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTable.id,
      field: {
        type: 'lookup',
        name: 'Source Name',
        options: {
          linkFieldId,
          foreignTableId: sourceTable.id,
          lookupFieldId: sourceNameFieldId,
        },
      },
    });
    const lookupFieldId = findFieldId(hostWithLookup, 'Source Name');

    const hostWithFormula = await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTable.id,
      field: {
        type: 'formula',
        name: 'Linked Count',
        options: {
          expression: `COUNTALL({${linkFieldId}})`,
        },
      },
    });
    const formulaFieldId = findFieldId(hostWithFormula, 'Linked Count');
    const titleFieldId = findFieldId(hostWithFormula, 'Title');
    const viewId = getViewId(hostWithFormula);

    const hostRecord = await ctx.createRecord(hostTable.id, {
      [titleFieldId]: 'Host 1',
    });
    await ctx.updateRecord(hostTable.id, hostRecord.id, {
      [linkFieldId]: { id: sourceRecord.id },
    });
    await ctx.drainOutbox(3);

    const beforeDelete = (await ctx.listRecords(hostTable.id)).find(
      (item) => item.id === hostRecord.id
    );
    expect(beforeDelete?.fields[lookupFieldId]).toEqual(['Source A']);
    expect(Number(beforeDelete?.fields[formulaFieldId])).toBe(1);

    await ctx.deleteByRange({
      tableId: hostTable.id,
      viewId,
      type: 'rows',
      ranges: [[0, 0]],
    });
    expect(await ctx.listRecords(hostTable.id)).toHaveLength(0);

    await executeUndo(ctx, hostTable.id);
    await ctx.drainOutbox(3);

    const restored = (await ctx.listRecords(hostTable.id)).find(
      (item) => item.id === hostRecord.id
    );
    expect(restored).toBeDefined();
    expect(restored?.fields[lookupFieldId]).toEqual(['Source A']);
    expect(Number(restored?.fields[formulaFieldId])).toBe(1);
  });

  it('[Y5650] streams deletion of a required self-link cycle larger than one batch', async () => {
    const table = await createBasicTable(ctx, 'Required Self-link Stream Delete');
    try {
      const titleId = findFieldId(table, 'Title');
      const withLink = await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: {
          type: 'link',
          name: 'Parent',
          options: {
            relationship: 'manyOne',
            foreignTableId: table.id,
            lookupFieldId: titleId,
            isOneWay: true,
          },
        },
      });
      const parentId = findFieldId(withLink, 'Parent');
      const largeRingSize = 250;
      const rowCount = largeRingSize + 2;
      const records = await ctx.createRecords(
        table.id,
        Array.from({ length: rowCount }, (_, index) => ({ fields: { [titleId]: `Row ${index}` } }))
      );
      await ctx.updateRecords({
        tableId: table.id,
        records: records.map((record, index) => {
          const nextIndex =
            index < largeRingSize ? (index + 1) % largeRingSize : 2 * largeRingSize + 1 - index;
          return { id: record.id, fields: { [parentId]: { id: records[nextIndex]!.id } } };
        }),
      });
      await ctx.drainOutbox();
      await ctx.updateField({
        baseId: ctx.baseId,
        tableId: table.id,
        fieldId: parentId,
        field: { notNull: true },
      });

      const result = await getCommandBus(ctx).execute(
        buildUndoRedoContext(),
        DeleteByRangeStreamCommand.create({
          tableId: table.id,
          viewId: getViewId(table),
          type: 'rows',
          ranges: [[0, rowCount - 1]],
          targetRecordIds: records.map((record) => record.id),
          batchSize: 200,
        })._unsafeUnwrap()
      );
      const events = await collectStreamEvents(result._unsafeUnwrap());
      expect(events.filter((event) => event.id === 'error')).toEqual([]);
      const committedBatchSizes = events.flatMap((event) =>
        event.id === 'progress' && event.phase === 'deleting' && event.batchDeletedCount > 0
          ? [event.batchDeletedCount]
          : []
      );
      expect(committedBatchSizes.sort((a, b) => a - b)).toEqual([2, largeRingSize]);
      expect(events.at(-1)).toMatchObject({
        id: 'done',
        totalCount: rowCount,
        deletedCount: rowCount,
      });
      expect(await ctx.listRecords(table.id)).toEqual([]);
    } finally {
      await ctx.deleteTable(table.id, { mode: 'permanent' });
    }
  });

  it('commits successful streamed chunks, preserves failed chunks, and undoes only deleted rows', async () => {
    const table = await createBasicTable(ctx, 'Undo E2E DeleteByRange Stream Partial Failure');
    const viewId = getViewId(table);
    const titleFieldId = findFieldId(table, 'Title');
    const amountFieldId = findFieldId(table, 'Amount');
    const totalRecords = 1000;
    const records = await ctx.createRecords(
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
      name: `e2e-fail-second-stream-delete-${Date.now()}`,
      supports: (operation) => operation === RecordWriteOperationKind.deleteMany,
      beforePersist: (context) => {
        if (
          context.kind === RecordWriteOperationKind.deleteMany &&
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
        DeleteByRangeStreamCommand.create({
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

      const remainingAfterDelete = await ctx.listRecords(table.id, { limit: totalRecords });
      expect(remainingAfterDelete).toHaveLength(500);
      expect(remainingAfterDelete.map((record) => record.id)).toEqual(
        records.slice(500).map((record) => record.id)
      );

      const newEvents = ctx.testContainer.eventBus.events().slice(eventCountBefore);
      const recordsDeletedEvents = newEvents.filter(
        (event): event is RecordsDeleted => event instanceof RecordsDeleted
      );
      expect(recordsDeletedEvents).toHaveLength(1);
      expect(recordsDeletedEvents[0]?.recordIds).toHaveLength(500);
      expect(recordsDeletedEvents[0]?.recordIds.map((recordId) => recordId.toString())).toEqual(
        records.slice(0, 500).map((record) => record.id)
      );

      await executeUndo(ctx, table.id);
      const restored = await ctx.listRecords(table.id, { limit: totalRecords });
      expect(restored).toHaveLength(totalRecords);
      expect(restored.find((record) => record.id === records[0]!.id)?.fields[amountFieldId]).toBe(
        0
      );
      expect(
        restored.find((record) => record.id === records[totalRecords - 1]!.id)?.fields[
          amountFieldId
        ]
      ).toBe(totalRecords - 1);
    } finally {
      const pluginIndex = plugins.findIndex((plugin) => plugin.name === failSecondChunkPlugin.name);
      if (pluginIndex >= 0) {
        plugins.splice(pluginIndex, 1);
      }
    }
  });
});
