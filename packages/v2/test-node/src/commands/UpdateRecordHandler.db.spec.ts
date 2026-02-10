/* eslint-disable @typescript-eslint/naming-convention */
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateRecordCommand,
  CreateTableCommand,
  UpdateRecordCommand,
  type CreateRecordResult,
  type CreateTableResult,
  type ICommandBus,
  type UpdateRecordResult,
  FieldKeyType,
  v2CoreTokens,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';

import { getV2NodeTestContainer, setV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

type DynamicDb = V1TeableDatabase & Record<string, Record<string, unknown>>;

describe('UpdateRecordHandler (db)', () => {
  beforeEach(async () => {
    await getV2NodeTestContainer().dispose();
    setV2NodeTestContainer(await createV2NodeTestContainer());
  });

  const createContext = () => {
    const actorIdResult = ActorId.create('system');
    return { actorId: actorIdResult._unsafeUnwrap() };
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
        { type: 'checkbox', name: 'Approved' },
      ],
      views: [{ type: 'grid' }],
    })._unsafeUnwrap();

    const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      createContext(),
      command
    );

    return result._unsafeUnwrap();
  };

  it('updates a record in the database', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

    const { table } = await createTestTable(commandBus, baseId.toString(), 'Update Records');
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
      createContext(),
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
      createContext(),
      updateRecordCommand
    );
    updateResult._unsafeUnwrap();

    const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();

    const rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom(dbTableName)
      .selectAll()
      .where('__id', '=', record.id().toString())
      .execute();

    expect(rows.length).toBe(1);
    const row = rows[0];
    const titleDbField = titleField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();
    const amountDbField = amountField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();

    expect(row[titleDbField]).toBe('Updated');
    expect(row[amountDbField]).toBe(99);
    expect(row['__version']).toBe(2);
  });

  it('normalizes checkbox false to null for name keys', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

    const { table } = await createTestTable(commandBus, baseId.toString(), 'Checkbox Compat');
    const tableId = table.id().toString();

    const fields = table.getFields();
    const titleField = fields.find((f) => f.name().toString() === 'Title');
    const approvedField = fields.find((f) => f.name().toString() === 'Approved');

    expect(titleField).toBeDefined();
    expect(approvedField).toBeDefined();
    if (!titleField || !approvedField) return;

    const createRecordCommand = CreateRecordCommand.create({
      tableId,
      fields: {
        [titleField.id().toString()]: 'Original',
        [approvedField.id().toString()]: true,
      },
    })._unsafeUnwrap();

    const createResult = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
      createContext(),
      createRecordCommand
    );
    const { record } = createResult._unsafeUnwrap();

    const updateRecordCommand = UpdateRecordCommand.create({
      tableId,
      recordId: record.id().toString(),
      fieldKeyType: FieldKeyType.Name,
      fields: {
        [titleField.name().toString()]: 'Updated',
        [approvedField.name().toString()]: false,
      },
    })._unsafeUnwrap();

    const updateResult = await commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
      createContext(),
      updateRecordCommand
    );
    updateResult._unsafeUnwrap();

    const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom(dbTableName)
      .selectAll()
      .where('__id', '=', record.id().toString())
      .execute();

    expect(rows.length).toBe(1);
    const row = rows[0];
    const approvedDbField = approvedField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();

    expect(row[approvedDbField]).toBeNull();
  });
});
