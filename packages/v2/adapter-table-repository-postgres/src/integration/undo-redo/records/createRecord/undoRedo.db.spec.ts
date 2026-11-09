/* eslint-disable @typescript-eslint/naming-convention */
import {
  CreateRecordCommand,
  CreateRecordsCommand,
  v2CoreTokens,
  type CreateRecordResult,
  type CreateRecordsResult,
  type IExecutionContext,
  type IUndoRedoStore,
} from '@teable/v2-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createBasicTable,
  createSelectTable,
  createUndoRedoDbHarness,
  disposeHarness,
  fetchRowById,
  findField,
  getFieldDbName,
  getViewId,
  getSelectOptionNames,
  listRowsByViewOrder,
  loadTable,
  type UndoRedoDbHarness,
} from '../../shared/undoRedoDbTestKit';

describe('undo-redo/createRecord (db)', () => {
  let harness: UndoRedoDbHarness | undefined;

  beforeEach(async () => {
    harness = await createUndoRedoDbHarness();
  });

  afterEach(async () => {
    await disposeHarness(harness);
    harness = undefined;
  });

  it('replays delete on undo and restore on redo', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo Create Record');
    const titleField = findField(table, 'Title');
    const amountField = findField(table, 'Amount');
    const amountDbName = getFieldDbName(table, 'Amount');
    const store = harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);

    const createCommand = CreateRecordCommand.create({
      tableId: table.id().toString(),
      fields: {
        [titleField.id().toString()]: 'Alpha',
        [amountField.id().toString()]: 42,
      },
    })._unsafeUnwrap();

    const createResult = await harness.execute<CreateRecordCommand, CreateRecordResult>(
      createCommand
    );
    const recordId = createResult.record.id().toString();

    const entry = (
      await store.list({
        actorId: harness.context.actorId,
        tableId: table.id(),
        windowId: harness.context.windowId!,
      })
    )._unsafeUnwrap()[0];

    expect(entry?.undoCommand.type).toBe('DeleteRecords');
    expect(entry?.redoCommand.type).toBe('RestoreRecords');
    if (entry?.undoCommand.type === 'DeleteRecords') {
      expect(entry.undoCommand.payload.recordIds).toEqual([recordId]);
    }

    const createdRow = await fetchRowById(harness.db, table, recordId);
    expect(createdRow?.[amountDbName]).toBe(42);

    await harness.undo(table.id().toString());
    expect(harness.probe.names()).toEqual(['UndoCommand', 'DeleteRecordsCommand']);
    expect(await fetchRowById(harness.db, table, recordId)).toBeUndefined();

    await harness.redo(table.id().toString());
    expect(harness.probe.names()).toEqual(['RedoCommand', 'RestoreRecordsCommand']);
    const redoneRow = await fetchRowById(harness.db, table, recordId);
    expect(redoneRow?.[amountDbName]).toBe(42);
  });

  it('undoes and redoes select-option auto creation together with record creation', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createSelectTable(harness, 'Undo Create Record Select Options');
    const titleField = findField(table, 'Title');
    const statusField = findField(table, 'Status');
    const tagsField = findField(table, 'Tags');
    const statusDbName = getFieldDbName(table, 'Status');
    const tagsDbName = getFieldDbName(table, 'Tags');
    const store = harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);

    const createResult = await harness.execute<CreateRecordCommand, CreateRecordResult>(
      CreateRecordCommand.create({
        tableId: table.id().toString(),
        typecast: true,
        fields: {
          [titleField.id().toString()]: 'Auto Options',
          [statusField.id().toString()]: 'In Progress',
          [tagsField.id().toString()]: ['Tag A', 'Tag Z'],
        },
      })._unsafeUnwrap()
    );

    const entry = (
      await store.list({
        actorId: harness.context.actorId,
        tableId: table.id(),
        windowId: harness.context.windowId!,
      })
    )._unsafeUnwrap()[0];

    expect(entry?.undoCommand.type).toBe('Batch');
    expect(entry?.redoCommand.type).toBe('Batch');

    let loadedTable = await loadTable(harness, table);
    expect(getSelectOptionNames(loadedTable, 'Status')).toEqual(['Open', 'In Progress']);
    expect(getSelectOptionNames(loadedTable, 'Tags')).toEqual(['Tag A', 'Tag Z']);
    let createdRow = await fetchRowById(
      harness.db,
      loadedTable,
      createResult.record.id().toString()
    );
    expect(createdRow?.[statusDbName]).toBe('In Progress');
    expect(createdRow?.[tagsDbName]).toEqual(['Tag A', 'Tag Z']);

    await harness.undo(table.id().toString());
    expect(harness.probe.names()).toEqual([
      'UndoCommand',
      'DeleteRecordsCommand',
      'ApplyFieldSnapshotCommand',
      'UpdateFieldCommand',
      'ApplyFieldSnapshotCommand',
      'UpdateFieldCommand',
    ]);
    loadedTable = await loadTable(harness, table);
    expect(getSelectOptionNames(loadedTable, 'Status')).toEqual(['Open']);
    expect(getSelectOptionNames(loadedTable, 'Tags')).toEqual(['Tag A']);
    expect(
      await fetchRowById(harness.db, loadedTable, createResult.record.id().toString())
    ).toBeUndefined();

    await harness.redo(table.id().toString());
    expect(harness.probe.names()).toEqual([
      'RedoCommand',
      'ApplyFieldSnapshotCommand',
      'UpdateFieldCommand',
      'ApplyFieldSnapshotCommand',
      'UpdateFieldCommand',
      'RestoreRecordsCommand',
    ]);
    loadedTable = await loadTable(harness, table);
    expect(getSelectOptionNames(loadedTable, 'Status')).toEqual(['Open', 'In Progress']);
    expect(getSelectOptionNames(loadedTable, 'Tags')).toEqual(['Tag A', 'Tag Z']);
    createdRow = await fetchRowById(harness.db, loadedTable, createResult.record.id().toString());
    expect(createdRow?.[statusDbName]).toBe('In Progress');
    expect(createdRow?.[tagsDbName]).toEqual(['Tag A', 'Tag Z']);
  });

  it('captures and replays ordered record creation with the original record id and view position', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createBasicTable(harness, 'Undo Create Record With Order');
    const titleField = findField(table, 'Title');
    const viewId = getViewId(table);

    const anchorA = await harness.execute<CreateRecordCommand, CreateRecordResult>(
      CreateRecordCommand.create({
        tableId: table.id().toString(),
        fields: {
          [titleField.id().toString()]: 'Anchor A',
        },
      })._unsafeUnwrap()
    );
    const anchorB = await harness.execute<CreateRecordCommand, CreateRecordResult>(
      CreateRecordCommand.create({
        tableId: table.id().toString(),
        fields: {
          [titleField.id().toString()]: 'Anchor B',
        },
      })._unsafeUnwrap()
    );

    const createResult = await harness.execute<CreateRecordCommand, CreateRecordResult>(
      CreateRecordCommand.create({
        tableId: table.id().toString(),
        fields: {
          [titleField.id().toString()]: 'Inserted',
        },
        order: {
          viewId,
          anchorId: anchorA.record.id().toString(),
          position: 'after',
        },
      })._unsafeUnwrap()
    );
    const recordId = createResult.record.id().toString();

    const entry = (
      await harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore).list({
        actorId: harness.context.actorId,
        tableId: table.id(),
        windowId: harness.context.windowId!,
      })
    )
      ._unsafeUnwrap()
      .at(-1);

    expect(entry?.redoCommand.type).toBe('RestoreRecords');
    if (entry?.redoCommand.type === 'RestoreRecords') {
      expect(entry.redoCommand.payload.records[0]?.recordId).toBe(recordId);
      expect(entry.redoCommand.payload.records[0]?.orders?.[viewId]).toBeTypeOf('number');
    }

    let orderedRows = await listRowsByViewOrder(harness.db, table, viewId);
    expect(orderedRows.map((row) => row.__id)).toEqual([
      anchorA.record.id().toString(),
      recordId,
      anchorB.record.id().toString(),
    ]);

    await harness.undo(table.id().toString());
    orderedRows = await listRowsByViewOrder(harness.db, table, viewId);
    expect(orderedRows.map((row) => row.__id)).toEqual([
      anchorA.record.id().toString(),
      anchorB.record.id().toString(),
    ]);

    await harness.redo(table.id().toString());
    orderedRows = await listRowsByViewOrder(harness.db, table, viewId);
    expect(orderedRows.map((row) => row.__id)).toEqual([
      anchorA.record.id().toString(),
      recordId,
      anchorB.record.id().toString(),
    ]);
  });

  const ignoredCreateContextVariants: ReadonlyArray<{
    readonly label: string;
    readonly buildContext: (base: IExecutionContext) => IExecutionContext;
  }> = [
    { label: 'without a window', buildContext: ({ actorId }) => ({ actorId }) },
    {
      label: 'during undo replay',
      buildContext: (base) => ({ ...base, undoRedo: { mode: 'undo' } }),
    },
    {
      label: 'during redo replay',
      buildContext: (base) => ({ ...base, undoRedo: { mode: 'redo' } }),
    },
  ];

  for (const variant of ignoredCreateContextVariants) {
    it(`creates records ${variant.label} and keeps them out of the window undo stack`, async () => {
      if (!harness) throw new Error('Missing harness');
      const activeHarness = harness;

      const table = await createBasicTable(activeHarness, `Undo Create Record ${variant.label}`);
      const titleField = findField(table, 'Title');
      const amountField = findField(table, 'Amount');
      const titleDbName = getFieldDbName(table, 'Title');
      const amountDbName = getFieldDbName(table, 'Amount');

      const expectRow = async (recordId: string, title: string, amount: number) => {
        const row = await fetchRowById(activeHarness.db, table, recordId);
        expect(row?.[titleDbName]).toBe(title);
        expect(row?.[amountDbName]).toBe(amount);
      };

      const windowRecord = await activeHarness.execute<CreateRecordCommand, CreateRecordResult>(
        CreateRecordCommand.create({
          tableId: table.id().toString(),
          fields: {
            [titleField.id().toString()]: 'Window A',
            [amountField.id().toString()]: 7,
          },
        })._unsafeUnwrap()
      );
      const windowRecordId = windowRecord.record.id().toString();

      const ignoredResult = await activeHarness.execute<CreateRecordsCommand, CreateRecordsResult>(
        CreateRecordsCommand.create({
          tableId: table.id().toString(),
          records: [
            {
              fields: {
                [titleField.id().toString()]: 'Untracked B',
                [amountField.id().toString()]: 1,
              },
            },
            {
              fields: {
                [titleField.id().toString()]: 'Untracked C',
                [amountField.id().toString()]: 2,
              },
            },
          ],
        })._unsafeUnwrap(),
        variant.buildContext(activeHarness.context)
      );

      const [untrackedB, untrackedC] = ignoredResult.records;
      if (!untrackedB || !untrackedC) throw new Error('Missing created records');
      const untrackedBId = untrackedB.id().toString();
      const untrackedCId = untrackedC.id().toString();

      const singleResult = await activeHarness.execute<CreateRecordCommand, CreateRecordResult>(
        CreateRecordCommand.create({
          tableId: table.id().toString(),
          fields: {
            [titleField.id().toString()]: 'Untracked D',
            [amountField.id().toString()]: 3,
          },
        })._unsafeUnwrap(),
        variant.buildContext(activeHarness.context)
      );
      const untrackedDId = singleResult.record.id().toString();

      await expectRow(windowRecordId, 'Window A', 7);
      await expectRow(untrackedBId, 'Untracked B', 1);
      await expectRow(untrackedCId, 'Untracked C', 2);
      await expectRow(untrackedDId, 'Untracked D', 3);

      await activeHarness.undo(table.id().toString());
      expect(await fetchRowById(activeHarness.db, table, windowRecordId)).toBeUndefined();
      await expectRow(untrackedBId, 'Untracked B', 1);
      await expectRow(untrackedCId, 'Untracked C', 2);
      await expectRow(untrackedDId, 'Untracked D', 3);

      await activeHarness.redo(table.id().toString());
      await expectRow(windowRecordId, 'Window A', 7);
      await expectRow(untrackedBId, 'Untracked B', 1);
      await expectRow(untrackedCId, 'Untracked C', 2);
      await expectRow(untrackedDId, 'Untracked D', 3);
    });
  }
});
