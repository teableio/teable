/* eslint-disable @typescript-eslint/naming-convention */
import {
  CreateFieldCommand,
  CreateRecordCommand,
  UpdateFieldCommand,
  v2CoreTokens,
  type CreateFieldResult,
  type CreateRecordResult,
  type IUndoRedoStore,
  type UpdateFieldResult,
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
  getSelectOptionNames,
  loadTable,
  type UndoRedoDbHarness,
} from '../../shared/undoRedoDbTestKit';

describe('undo-redo/updateField (db)', () => {
  let harness: UndoRedoDbHarness | undefined;

  beforeEach(async () => {
    harness = await createUndoRedoDbHarness();
  });

  afterEach(async () => {
    await disposeHarness(harness);
    harness = undefined;
  });

  it('replays dedicated field-type-conversion command on undo and redo', async () => {
    if (!harness) throw new Error('Missing harness');
    const currentHarness = harness;

    const table = await createBasicTable(currentHarness, 'Undo Update Field');
    const titleField = findField(table, 'Title');
    const scoreFieldId = `fld${'u'.repeat(16)}`;
    const store = currentHarness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);

    const createFieldResult = await currentHarness.execute<CreateFieldCommand, CreateFieldResult>(
      CreateFieldCommand.create({
        baseId: currentHarness.testContainer.baseId.toString(),
        tableId: table.id().toString(),
        field: {
          id: scoreFieldId,
          type: 'singleLineText',
          name: 'Score',
        },
      })._unsafeUnwrap()
    );
    const scoreDbName = getFieldDbName(createFieldResult.table, 'Score');

    const records = await Promise.all([
      currentHarness.execute<CreateRecordCommand, CreateRecordResult>(
        CreateRecordCommand.create({
          tableId: table.id().toString(),
          fields: {
            [titleField.id().toString()]: 'R1',
            [scoreFieldId]: '42',
          },
        })._unsafeUnwrap()
      ),
      currentHarness.execute<CreateRecordCommand, CreateRecordResult>(
        CreateRecordCommand.create({
          tableId: table.id().toString(),
          fields: {
            [titleField.id().toString()]: 'R2',
            [scoreFieldId]: '7',
          },
        })._unsafeUnwrap()
      ),
      currentHarness.execute<CreateRecordCommand, CreateRecordResult>(
        CreateRecordCommand.create({
          tableId: table.id().toString(),
          fields: {
            [titleField.id().toString()]: 'R3',
            [scoreFieldId]: '100',
          },
        })._unsafeUnwrap()
      ),
    ]);

    await currentHarness.execute<UpdateFieldCommand, UpdateFieldResult>(
      UpdateFieldCommand.create({
        tableId: table.id().toString(),
        fieldId: scoreFieldId,
        field: {
          type: 'number',
        },
      })._unsafeUnwrap()
    );

    const entry = (
      await store.list({
        actorId: currentHarness.context.actorId,
        tableId: table.id(),
        windowId: currentHarness.context.windowId!,
      })
    )
      ._unsafeUnwrap()
      .at(-1);

    expect(entry?.undoCommand.type).toBe('ReplayFieldTypeConversion');
    expect(entry?.redoCommand.type).toBe('ReplayFieldTypeConversion');

    let updatedTable = await loadTable(currentHarness, table);
    expect(
      updatedTable
        .getFields()
        .find((field) => field.id().toString() === scoreFieldId)
        ?.type()
        .toString()
    ).toBe('number');
    let updatedRows = await Promise.all(
      records.map((record) =>
        fetchRowById(currentHarness.db, updatedTable, record.record.id().toString())
      )
    );
    expect(updatedRows.map((row) => row?.[scoreDbName])).toEqual([42, 7, 100]);

    await currentHarness.undo(table.id().toString());
    expect(currentHarness.probe.names()).toEqual([
      'UndoCommand',
      'ReplayFieldTypeConversionCommand',
      'UpdateFieldCommand',
    ]);

    updatedTable = await loadTable(currentHarness, table);
    expect(
      updatedTable
        .getFields()
        .find((field) => field.id().toString() === scoreFieldId)
        ?.type()
        .toString()
    ).toBe('singleLineText');
    updatedRows = await Promise.all(
      records.map((record) =>
        fetchRowById(currentHarness.db, updatedTable, record.record.id().toString())
      )
    );
    expect(updatedRows.map((row) => row?.[scoreDbName])).toEqual(['42', '7', '100']);

    await currentHarness.redo(table.id().toString());
    expect(currentHarness.probe.names()).toEqual([
      'RedoCommand',
      'ReplayFieldTypeConversionCommand',
      'UpdateFieldCommand',
    ]);

    updatedTable = await loadTable(currentHarness, table);
    expect(
      updatedTable
        .getFields()
        .find((field) => field.id().toString() === scoreFieldId)
        ?.type()
        .toString()
    ).toBe('number');
    updatedRows = await Promise.all(
      records.map((record) =>
        fetchRowById(currentHarness.db, updatedTable, record.record.id().toString())
      )
    );
    expect(updatedRows.map((row) => row?.[scoreDbName])).toEqual([42, 7, 100]);
  });

  it('replays option updates through update-field logic without record snapshot writes', async () => {
    if (!harness) throw new Error('Missing harness');

    const table = await createSelectTable(harness, 'Undo Update Field Options');
    const statusField = findField(table, 'Status');
    const titleField = findField(table, 'Title');
    const statusDbName = getFieldDbName(table, 'Status');
    const existingStatusOption = (
      statusField as unknown as {
        selectOptions(): Array<{
          id(): { toString(): string };
          color(): { toString(): string };
        }>;
      }
    ).selectOptions()[0];
    if (!existingStatusOption) {
      throw new Error('Missing existing status option');
    }

    const record = await harness.execute<CreateRecordCommand, CreateRecordResult>(
      CreateRecordCommand.create({
        tableId: table.id().toString(),
        fields: {
          [titleField.id().toString()]: 'R1',
          [statusField.id().toString()]: 'Open',
        },
      })._unsafeUnwrap()
    );

    await harness.execute<UpdateFieldCommand, UpdateFieldResult>(
      UpdateFieldCommand.create({
        tableId: table.id().toString(),
        fieldId: statusField.id().toString(),
        field: {
          options: {
            choices: [
              {
                id: existingStatusOption.id().toString(),
                name: 'In Progress',
                color: existingStatusOption.color().toString(),
              },
            ],
          },
        },
      })._unsafeUnwrap()
    );

    const entry = (
      await harness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore).list({
        actorId: harness.context.actorId,
        tableId: table.id(),
        windowId: harness.context.windowId!,
      })
    )
      ._unsafeUnwrap()
      .at(-1);

    expect(entry?.undoCommand.type).toBe('ApplyFieldSnapshot');
    expect(entry?.redoCommand.type).toBe('ApplyFieldSnapshot');

    let updatedTable = await loadTable(harness, table);
    expect(getSelectOptionNames(updatedTable, 'Status')).toEqual(['In Progress']);
    let updatedRow = await fetchRowById(harness.db, updatedTable, record.record.id().toString());
    expect(updatedRow?.[statusDbName]).toBe('In Progress');

    await harness.undo(table.id().toString());
    expect(harness.probe.names()).toEqual([
      'UndoCommand',
      'ApplyFieldSnapshotCommand',
      'UpdateFieldCommand',
    ]);

    updatedTable = await loadTable(harness, table);
    expect(getSelectOptionNames(updatedTable, 'Status')).toEqual(['Open']);
    expect(
      updatedTable
        .getFields()
        .find((field) => field.id().toString() === statusField.id().toString())
        ?.type()
        .toString()
    ).toBe('singleSelect');
    updatedRow = await fetchRowById(harness.db, updatedTable, record.record.id().toString());
    expect(updatedRow?.[statusDbName]).toBe('Open');

    await harness.redo(table.id().toString());
    expect(harness.probe.names()).toEqual([
      'RedoCommand',
      'ApplyFieldSnapshotCommand',
      'UpdateFieldCommand',
    ]);

    updatedTable = await loadTable(harness, table);
    expect(getSelectOptionNames(updatedTable, 'Status')).toEqual(['In Progress']);
    updatedRow = await fetchRowById(harness.db, updatedTable, record.record.id().toString());
    expect(updatedRow?.[statusDbName]).toBe('In Progress');
  });
});
