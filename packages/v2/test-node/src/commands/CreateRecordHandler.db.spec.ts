/* eslint-disable @typescript-eslint/naming-convention */
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateRecordCommand,
  CreateTableCommand,
  type CreateRecordResult,
  type CreateTableResult,
  type ICommandBus,
  v2CoreTokens,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';

import { getV2NodeTestContainer, setV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

type DynamicDb = V1TeableDatabase & Record<string, Record<string, unknown>>;

describe('CreateRecordHandler (db)', () => {
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

  it('inserts a record into the database', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

    // Create a table first
    const { table } = await createTestTable(commandBus, baseId.toString(), 'Records Table');
    const tableId = table.id().toString();

    // Get field IDs
    const fields = table.getFields();
    const titleField = fields.find((f) => f.name().toString() === 'Title');
    const amountField = fields.find((f) => f.name().toString() === 'Amount');
    const approvedField = fields.find((f) => f.name().toString() === 'Approved');

    expect(titleField).toBeDefined();
    expect(amountField).toBeDefined();
    expect(approvedField).toBeDefined();
    if (!titleField || !amountField || !approvedField) return;

    // Create a record
    const createRecordCommand = CreateRecordCommand.create({
      tableId,
      fields: {
        [titleField.id().toString()]: 'Test Record',
        [amountField.id().toString()]: 100,
        [approvedField.id().toString()]: true,
      },
    })._unsafeUnwrap();

    const result = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
      createContext(),
      createRecordCommand
    );
    result._unsafeUnwrap();

    const { record } = result._unsafeUnwrap();

    // Verify the record was inserted
    const dbTableNameResult = table.dbTableName();
    expect(dbTableNameResult.isOk()).toBe(true);
    const dbTableName = dbTableNameResult._unsafeUnwrap().value()._unsafeUnwrap();

    const rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom(dbTableName)
      .selectAll()
      .where('__id', '=', record.id().toString())
      .execute();

    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row['__id']).toBe(record.id().toString());
    expect(row['__version']).toBe(1);
    expect(row['__created_by']).toBe('system');

    // Verify field values
    const titleDbField = titleField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();
    const amountDbField = amountField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();
    const approvedDbField = approvedField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();

    expect(row[titleDbField]).toBe('Test Record');
    expect(row[amountDbField]).toBe(100);
    expect(row[approvedDbField]).toBe(true);
  });

  it('inserts a record with empty fields', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

    const { table } = await createTestTable(commandBus, baseId.toString(), 'Empty Fields Table');
    const tableId = table.id().toString();

    const createRecordCommand = CreateRecordCommand.create({
      tableId,
      fields: {},
    })._unsafeUnwrap();

    const result = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
      createContext(),
      createRecordCommand
    );
    result._unsafeUnwrap();

    const { record } = result._unsafeUnwrap();

    const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();

    const rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom(dbTableName)
      .selectAll()
      .where('__id', '=', record.id().toString())
      .execute();

    expect(rows.length).toBe(1);
    expect(rows[0]['__id']).toBe(record.id().toString());
  });

  it('inserts multiple records with unique IDs', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

    const { table } = await createTestTable(commandBus, baseId.toString(), 'Multiple Records');
    const tableId = table.id().toString();

    const recordIds: string[] = [];

    // Create 3 records
    for (let i = 0; i < 3; i += 1) {
      const createRecordCommand = CreateRecordCommand.create({
        tableId,
        fields: {},
      })._unsafeUnwrap();

      const result = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        createContext(),
        createRecordCommand
      );
      const { record } = result._unsafeUnwrap();
      recordIds.push(record.id().toString());
    }

    // Verify all records exist
    const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();

    const rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom(dbTableName)
      .select('__id')
      .execute();

    expect(rows.length).toBe(3);
    const dbRecordIds = new Set(rows.map((row) => row['__id']));
    for (const recordId of recordIds) {
      expect(dbRecordIds.has(recordId)).toBe(true);
    }
  });

  it('returns error when table not found', async () => {
    const { container } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const createRecordCommand = CreateRecordCommand.create({
      tableId: `tbl${'x'.repeat(16)}`,
      fields: {},
    })._unsafeUnwrap();

    const result = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
      createContext(),
      createRecordCommand
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message.toLowerCase()).toContain('not found');
  });
});
