/* eslint-disable @typescript-eslint/naming-convention */
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateRecordCommand,
  CreateTableCommand,
  MemoryUndoRedoStore,
  RedoCommand,
  UndoCommand,
  UpdateRecordCommand,
  type CreateRecordResult,
  type CreateTableResult,
  type ICommandBus,
  type UpdateRecordResult,
  v2CoreTokens,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Result } from 'neverthrow';

import { getV2NodeTestContainer, setV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

type DynamicDb = V1TeableDatabase & Record<string, Record<string, unknown>>;

describe('UpdateRecord undo/redo (db)', () => {
  beforeEach(async () => {
    await getV2NodeTestContainer().dispose();
    setV2NodeTestContainer(await createV2NodeTestContainer());
  });

  const createContext = (windowId: string) => {
    const actorIdResult = ActorId.create('system');
    return { actorId: actorIdResult._unsafeUnwrap(), windowId };
  };

  const unwrap = <T, E extends { message: string }>(result: Result<T, E>, label: string): T => {
    if (result.isErr()) {
      throw new Error(`${label}: ${result.error.message}`);
    }
    return result.value;
  };

  const createTestTable = async (
    commandBus: ICommandBus,
    baseId: string,
    tableName: string
  ): Promise<CreateTableResult> => {
    const command = CreateTableCommand.create({
      baseId,
      name: tableName,
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
      ],
      views: [{ type: 'grid' }],
    })._unsafeUnwrap();

    const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      createContext('window-1'),
      command
    );

    return result._unsafeUnwrap();
  };

  it('undo/redo update record scoped by window', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    container.registerInstance(v2CoreTokens.undoRedoStore, new MemoryUndoRedoStore());

    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

    const { table } = await createTestTable(commandBus, baseId.toString(), 'Undo Redo Records');
    const tableId = table.id().toString();

    const fields = table.getFields();
    const titleField = fields.find((f) => f.name().toString() === 'Title');
    const amountField = fields.find((f) => f.name().toString() === 'Amount');

    expect(titleField).toBeDefined();
    expect(amountField).toBeDefined();
    if (!titleField || !amountField) return;

    const createRecordCommand = CreateRecordCommand.create({
      tableId,
      fields: {
        [titleField.id().toString()]: 'Original',
        [amountField.id().toString()]: 10,
      },
    })._unsafeUnwrap();

    const createResult = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
      createContext('window-1'),
      createRecordCommand
    );
    const { record } = createResult._unsafeUnwrap();

    const updateRecordCommand = UpdateRecordCommand.create({
      tableId,
      recordId: record.id().toString(),
      fields: {
        [titleField.id().toString()]: 'Updated',
        [amountField.id().toString()]: 99,
      },
    })._unsafeUnwrap();

    const updateResult = await commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
      createContext('window-1'),
      updateRecordCommand
    );
    unwrap(updateResult, 'updateResult');

    const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const titleDbField = titleField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();
    const amountDbField = amountField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();

    const fetchRow = async () => {
      const rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
        .selectFrom(dbTableName)
        .selectAll()
        .where('__id', '=', record.id().toString())
        .execute();
      expect(rows.length).toBe(1);
      return rows[0];
    };

    const updatedRow = await fetchRow();
    expect(updatedRow[titleDbField]).toBe('Updated');
    expect(updatedRow[amountDbField]).toBe(99);
    expect(updatedRow['__version']).toBe(2);

    const undoWrongWindow = UndoCommand.create({
      tableId,
      windowId: 'window-2',
    })._unsafeUnwrap();
    const undoWrongResult = await commandBus.execute<UndoCommand, unknown>(
      createContext('window-2'),
      undoWrongWindow
    );
    unwrap(undoWrongResult, 'undoWrongResult');

    const stillUpdated = await fetchRow();
    expect(stillUpdated[titleDbField]).toBe('Updated');
    expect(stillUpdated[amountDbField]).toBe(99);
    expect(stillUpdated['__version']).toBe(2);

    const undoCommand = UndoCommand.create({
      tableId,
      windowId: 'window-1',
    })._unsafeUnwrap();
    const undoResult = await commandBus.execute<UndoCommand, unknown>(
      createContext('window-1'),
      undoCommand
    );
    unwrap(undoResult, 'undoResult');

    const undoneRow = await fetchRow();
    expect(undoneRow[titleDbField]).toBe('Original');
    expect(undoneRow[amountDbField]).toBe(10);
    expect(undoneRow['__version']).toBe(3);

    const redoCommand = RedoCommand.create({
      tableId,
      windowId: 'window-1',
    })._unsafeUnwrap();
    const redoResult = await commandBus.execute<RedoCommand, unknown>(
      createContext('window-1'),
      redoCommand
    );
    unwrap(redoResult, 'redoResult');

    const redoneRow = await fetchRow();
    expect(redoneRow[titleDbField]).toBe('Updated');
    expect(redoneRow[amountDbField]).toBe(99);
    expect(redoneRow['__version']).toBe(4);
  });
});
