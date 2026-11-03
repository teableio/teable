/* eslint-disable @typescript-eslint/naming-convention */
import { registerV2PostgresDb, v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateRecordCommand,
  CreateTableCommand,
  UpdateRecordCommand,
  type CreateRecordResult,
  type CreateTableResult,
  type ICommandBus,
  type UpdateRecordResult,
  v2CoreTokens,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type DynamicDb = V1TeableDatabase & Record<string, Record<string, unknown>>;

const CONNECTION_TIMEOUT_MS = 1_000;

describe('UpdateRecord no-op authoritative read (single-connection postgres)', () => {
  let postgres: StartedPostgreSqlContainer | undefined;
  let testContainer: IV2NodeTestContainer | undefined;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer(
      process.env.TEABLE_V2_TEST_PG_IMAGE ?? 'postgres:16-alpine'
    ).start();
    testContainer = await createV2NodeTestContainer({
      connectionString: postgres.getConnectionUri(),
      schemaCoordination: false,
      registerDb: (container, config) =>
        registerV2PostgresDb(container, {
          pg: {
            ...config.pg,
            pool: {
              max: 1,
              connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
              allowExitOnIdle: true,
            },
          },
        }),
    });
  }, 120_000);

  afterAll(async () => {
    try {
      await testContainer?.dispose();
    } finally {
      await postgres?.stop();
    }
  });

  it('returns the stored record before the only pool connection times out', async () => {
    if (!testContainer) throw new Error('Postgres test container was not initialized');

    const commandBus = testContainer.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = testContainer.container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);
    const context = { actorId: ActorId.create('system')._unsafeUnwrap() };

    const createTableResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      CreateTableCommand.create({
        baseId: testContainer.baseId.toString(),
        name: 'Single Connection No-op Update',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          { type: 'number', name: 'Amount' },
        ],
        views: [{ type: 'grid' }],
      })._unsafeUnwrap()
    );
    const { table } = createTableResult._unsafeUnwrap();
    const titleField = table.getFields().find((field) => field.name().toString() === 'Title');
    const amountField = table.getFields().find((field) => field.name().toString() === 'Amount');
    if (!titleField || !amountField) throw new Error('Expected Title and Amount fields');

    const createRecordResult = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
      context,
      CreateRecordCommand.create({
        tableId: table.id().toString(),
        fields: {
          [titleField.id().toString()]: 'Stored title',
          [amountField.id().toString()]: 42,
        },
      })._unsafeUnwrap()
    );
    const record = createRecordResult._unsafeUnwrap().record;

    const updateResult = await commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
      context,
      UpdateRecordCommand.create({
        tableId: table.id().toString(),
        recordId: record.id().toString(),
        fields: {
          [amountField.id().toString()]: 42,
        },
      })._unsafeUnwrap()
    );

    expect(updateResult.isOk(), updateResult.isErr() ? updateResult.error.message : undefined).toBe(
      true
    );
    const update = updateResult._unsafeUnwrap();
    expect(update.record.fields().get(titleField.id())?.toValue()).toBe('Stored title');
    expect(update.record.fields().get(amountField.id())?.toValue()).toBe(42);
    expect(update.events).toHaveLength(0);

    const tableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const amountColumn = amountField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();
    const stored = await db
      .selectFrom(tableName)
      .select([amountColumn, '__version'])
      .where('__id', '=', record.id().toString())
      .executeTakeFirstOrThrow();
    expect(stored[amountColumn]).toBe(42);
    expect(stored.__version).toBe(1);
  }, 30_000);
});
