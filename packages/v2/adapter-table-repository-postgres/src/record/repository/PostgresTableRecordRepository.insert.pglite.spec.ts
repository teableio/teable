/* eslint-disable require-yield */
import { PostgresUnitOfWorkTransaction } from '@teable/v2-adapter-db-postgres-shared';
import {
  ActorId,
  BaseId,
  DbFieldName,
  type IHasher,
  type ILogger,
  type IRecordOrderCalculator,
  FieldName,
  Table,
  TableId,
  TableName,
  ViewName,
  ok,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createPGliteDb } from '../../schema/visitors/__tests__/helpers/createPGliteDb';
import { installUndoCaptureGlobals } from '../../schema/visitors/__tests__/helpers/installUndoCaptureGlobals';
import type {
  ComputedFieldUpdater,
  ComputedUpdatePlanner,
  IComputedUpdateOutbox,
  IUpdateStrategy,
} from '../computed';
import type { DynamicDB } from '../query-builder';
import { createNoopEventBus } from './__tests__/helpers/createNoopEventBus';
import { PostgresRecordMutationSnapshotCaptureService } from './PostgresRecordMutationSnapshotCaptureService';
import { PostgresTableRecordRepository } from './PostgresTableRecordRepository';

const sanitizeIdSeed = (seed: string): string => seed.replace(/[^0-9a-z]/gi, '0');
const createId = (prefix: string, seed: string): string =>
  `${prefix}${sanitizeIdSeed(seed).padEnd(16, '0').slice(0, 16)}`;

const createLogger = (): ILogger => {
  const logger: ILogger = {
    child: () => logger,
    scope: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger;
};

const createNoopComputedPlanner = (table: Table): ComputedUpdatePlanner => {
  return {
    plan: async () =>
      ok({
        baseId: table.baseId(),
        seedTableId: table.id(),
        seedRecordIds: [],
        extraSeedRecords: [],
        steps: [],
        edges: [],
        estimatedComplexity: 0,
        changeType: 'insert',
      }),
    planStage: async () =>
      ok({
        baseId: table.baseId(),
        seedTableId: table.id(),
        seedRecordIds: [],
        extraSeedRecords: [],
        steps: [],
        edges: [],
        estimatedComplexity: 0,
        changeType: 'insert',
      }),
    resolveBeforeImageRequirements: async () =>
      ok({
        needsBeforeImage: false,
        requiredFieldIds: [],
      }),
  } as unknown as ComputedUpdatePlanner;
};

const createNoopStrategy = (): IUpdateStrategy => {
  return {
    mode: 'sync',
    name: 'noop',
    execute: async () => ok(undefined),
    scheduleDispatch: () => undefined,
  };
};

const createNoopOutbox = (): IComputedUpdateOutbox => {
  return {
    enqueueOrMerge: async () => ok({ taskId: 'test', merged: false }),
    enqueueSeedTask: async () => ok({ taskId: 'test', merged: false }),
    enqueueFieldBackfill: async () => ok({ taskId: 'test', merged: false }),
    claimBatch: async () => ok([]),
    claimById: async () => ok(null),
    renewLease: async () => ok([]),
    markDone: async () => ok(true),
    markFailed: async () => ok(true),
  };
};

const createNoopHasher = (): IHasher => {
  return {
    sha256: () => 'test-hash',
  };
};

const createNoopRecordOrderCalculator = (): IRecordOrderCalculator => {
  return {
    calculateOrders: async () => ok([]),
  };
};

const createRepository = (db: Kysely<DynamicDB>, table: Table) => {
  const logger = createLogger();
  const computedUpdatePlanner = createNoopComputedPlanner(table);
  const computedFieldUpdater = {} as ComputedFieldUpdater;
  const computedUpdateStrategy = createNoopStrategy();
  const computedUpdateOutbox = createNoopOutbox();
  const eventBus = createNoopEventBus();
  const hasher = createNoopHasher();

  return new PostgresTableRecordRepository(
    db as unknown as Kysely<V1TeableDatabase>,
    logger,
    createNoopRecordOrderCalculator(),
    computedUpdatePlanner,
    computedFieldUpdater,
    computedUpdateStrategy,
    computedUpdateOutbox,
    new PostgresRecordMutationSnapshotCaptureService(
      db as unknown as Kysely<V1TeableDatabase>,
      logger
    ),
    eventBus,
    hasher
  );
};

const createTableWithStorage = async (
  db: Kysely<V1TeableDatabase>,
  seed: string
): Promise<{
  table: Table;
  schemaName: string;
  tableName: string;
  viewOrderColumn: string;
  primaryFieldId: string;
}> => {
  const baseId = BaseId.create(createId('bse', seed))._unsafeUnwrap();
  const tableId = TableId.create(createId('tbl', seed))._unsafeUnwrap();

  const builder = Table.builder()
    .withBaseId(baseId)
    .withId(tableId)
    .withName(TableName.create(`Insert-${seed}`)._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().grid().withName(ViewName.create('Grid')._unsafeUnwrap()).done();
  const table = builder.build()._unsafeUnwrap();

  const primaryField = table.getFields()[0]!;
  primaryField.setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())._unsafeUnwrap();

  const schemaName = baseId.toString();
  const tableName = tableId.toString();
  const fullTableName = `${schemaName}.${tableName}`;
  const viewOrderColumn = table.views()[0]!.id().toRowOrderColumnName();

  await sql`CREATE SCHEMA ${sql.id(schemaName)}`.execute(db);
  await sql`
    CREATE TABLE ${sql.table(fullTableName)} (
      __id text PRIMARY KEY,
      __created_time timestamptz NOT NULL,
      __created_by text NOT NULL,
      __last_modified_time timestamptz NOT NULL,
      __last_modified_by text NOT NULL,
      __version integer NOT NULL,
      __auto_number serial NOT NULL,
      ${sql.id(viewOrderColumn)} double precision,
      col_name text
    )
  `.execute(db);

  await sql`
    INSERT INTO table_meta (id, last_modified_time, last_modified_by)
    VALUES (${table.id().toString()}, NOW(), 'seed')
    ON CONFLICT (id) DO NOTHING
  `.execute(db);

  return {
    table,
    schemaName,
    tableName,
    viewOrderColumn,
    primaryFieldId: primaryField.id().toString(),
  };
};

describe('PostgresTableRecordRepository.insert (pglite)', () => {
  let db: Kysely<V1TeableDatabase>;
  let destroyDb: (() => Promise<void>) | undefined;
  const createdSchemas: string[] = [];

  beforeAll(async () => {
    const pgliteDb = await createPGliteDb();
    db = pgliteDb.db;
    destroyDb = async () => {
      await pgliteDb.db.destroy();
    };

    await sql`
      CREATE TABLE IF NOT EXISTS table_meta (
        id text PRIMARY KEY,
        last_modified_time timestamptz,
        last_modified_by text
      )
    `.execute(db);

    await installUndoCaptureGlobals(db);
  });

  afterEach(async () => {
    for (const schemaName of createdSchemas) {
      await sql`DROP SCHEMA IF EXISTS ${sql.id(schemaName)} CASCADE`.execute(db);
    }
    createdSchemas.length = 0;
  });

  afterAll(async () => {
    await destroyDb?.();
  });

  it('sets default row order when inserting into schema-qualified table', async () => {
    const { table, schemaName, tableName, viewOrderColumn, primaryFieldId } =
      await createTableWithStorage(db, 'insert-default-order');
    createdSchemas.push(schemaName);

    const repository = createRepository(db as unknown as Kysely<DynamicDB>, table);
    const actorId = ActorId.create('tester')._unsafeUnwrap();
    const actorContext = {
      actorId,
      actorName: 'Tester',
      actorEmail: 'tester@example.com',
    };

    const recordA = table.createRecord(new Map([[primaryFieldId, 'A']]))._unsafeUnwrap().record;
    const firstInsertResult = await db.transaction().execute(async (trx) =>
      repository.insert(
        {
          ...actorContext,
          transaction: new PostgresUnitOfWorkTransaction(trx as never),
        },
        table,
        recordA
      )
    );
    expect(firstInsertResult.isOk()).toBe(true);

    const recordB = table.createRecord(new Map([[primaryFieldId, 'B']]))._unsafeUnwrap().record;
    const secondInsertResult = await db
      .transaction()
      .execute(async (trx) =>
        repository.insert(
          { ...actorContext, transaction: new PostgresUnitOfWorkTransaction(trx as never) },
          table,
          recordB
        )
      );
    expect(secondInsertResult.isOk()).toBe(true);

    const fullTableName = `${schemaName}.${tableName}`;
    const rows = await sql<{ __id: string; order_value: number | null }>`
      SELECT __id, ${sql.ref(viewOrderColumn)} as order_value
      FROM ${sql.table(fullTableName)}
      ORDER BY __auto_number ASC
    `.execute(db);

    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((row) => row.order_value != null)).toBe(true);
    expect(rows.rows.map((row) => row.order_value)).toEqual([1, 2]);
  });

  it('returns stored insert snapshots from mutation capture', async () => {
    const { table, schemaName, primaryFieldId } = await createTableWithStorage(
      db,
      'insert-snapshot'
    );
    createdSchemas.push(schemaName);

    const repository = createRepository(db as unknown as Kysely<DynamicDB>, table);
    const actorId = ActorId.create('tester')._unsafeUnwrap();
    const actorContext = {
      actorId,
      actorName: 'Tester',
      actorEmail: 'tester@example.com',
    };

    const firstRecord = table
      .createRecord(new Map([[primaryFieldId, 'Alpha']]))
      ._unsafeUnwrap().record;
    const firstInsertResult = await db
      .transaction()
      .execute(async (trx) =>
        repository.insert(
          { ...actorContext, transaction: new PostgresUnitOfWorkTransaction(trx as never) },
          table,
          firstRecord
        )
      );
    expect(firstInsertResult.isOk()).toBe(true);
    expect(firstInsertResult._unsafeUnwrap().recordSnapshot).toMatchObject({
      recordId: firstRecord.id().toString(),
      fields: {
        [primaryFieldId]: 'Alpha',
      },
    });

    const secondRecord = table
      .createRecord(new Map([[primaryFieldId, 'Beta']]))
      ._unsafeUnwrap().record;
    const secondInsertResult = await db
      .transaction()
      .execute(async (trx) =>
        repository.insertMany(
          { ...actorContext, transaction: new PostgresUnitOfWorkTransaction(trx as never) },
          table,
          [secondRecord]
        )
      );
    expect(secondInsertResult.isOk()).toBe(true);
    expect(secondInsertResult._unsafeUnwrap().recordSnapshots).toEqual([
      expect.objectContaining({
        recordId: secondRecord.id().toString(),
        fields: {
          [primaryFieldId]: 'Beta',
        },
      }),
    ]);
  });

  it('returns Err when insert snapshot capture does not record the inserted row', async () => {
    const { table, schemaName, primaryFieldId } = await createTableWithStorage(
      db,
      'insert-missing-snapshot'
    );
    createdSchemas.push(schemaName);

    await sql
      .raw(
        `
      CREATE OR REPLACE FUNCTION "public"."__teable_capture_undo_row"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RETURN NULL;
      END;
      $$;
    `
      )
      .execute(db);

    const repository = createRepository(db as unknown as Kysely<DynamicDB>, table);
    const actorId = ActorId.create('tester')._unsafeUnwrap();
    const actorContext = {
      actorId,
      actorName: 'Tester',
      actorEmail: 'tester@example.com',
    };

    const record = table.createRecord(new Map([[primaryFieldId, 'Gamma']]))._unsafeUnwrap().record;
    const insertResult = await db
      .transaction()
      .execute(async (trx) =>
        repository.insert(
          { ...actorContext, transaction: new PostgresUnitOfWorkTransaction(trx as never) },
          table,
          record
        )
      );

    expect(insertResult.isErr()).toBe(true);
    expect(insertResult._unsafeUnwrapErr().message).toContain(
      'Failed to capture complete insert snapshots'
    );

    await installUndoCaptureGlobals(db);
  });

  it('analyzes the first batch inserted into an empty table', async () => {
    const { table, schemaName, tableName, primaryFieldId } = await createTableWithStorage(
      db,
      'insertmany-analyze'
    );
    createdSchemas.push(schemaName);

    const repository = createRepository(db as unknown as Kysely<DynamicDB>, table);
    const actorId = ActorId.create('tester')._unsafeUnwrap();
    const actorContext = {
      actorId,
      actorName: 'Tester',
      actorEmail: 'tester@example.com',
    };

    const statsBefore = await sql<{ count: string }>`
      SELECT COUNT(*)::text AS count
      FROM pg_stats
      WHERE schemaname = ${schemaName}
      AND tablename = ${tableName}
    `.execute(db);
    expect(Number(statsBefore.rows[0]?.count ?? '0')).toBe(0);

    const recordA = table.createRecord(new Map([[primaryFieldId, 'A']]))._unsafeUnwrap().record;
    const recordB = table.createRecord(new Map([[primaryFieldId, 'B']]))._unsafeUnwrap().record;

    const result = await db
      .transaction()
      .execute(async (trx) =>
        repository.insertMany(
          { ...actorContext, transaction: new PostgresUnitOfWorkTransaction(trx as never) },
          table,
          [recordA, recordB]
        )
      );
    expect(result.isOk()).toBe(true);

    const statsAfter = await sql<{ count: string }>`
      SELECT COUNT(*)::text AS count
      FROM pg_stats
      WHERE schemaname = ${schemaName}
      AND tablename = ${tableName}
    `.execute(db);
    expect(Number(statsAfter.rows[0]?.count ?? '0')).toBeGreaterThan(0);
  });

  it('inserts a record even when no explicit field values changed', async () => {
    const { table, schemaName, tableName, viewOrderColumn } = await createTableWithStorage(
      db,
      'insert-empty-fields'
    );
    createdSchemas.push(schemaName);

    const repository = createRepository(db as unknown as Kysely<DynamicDB>, table);
    const actorId = ActorId.create('tester')._unsafeUnwrap();
    const context = { actorId };

    const emptyRecord = table.createRecord(new Map())._unsafeUnwrap().record;
    const insertResult = await repository.insert(context, table, emptyRecord);
    expect(insertResult.isOk()).toBe(true);

    const fullTableName = `${schemaName}.${tableName}`;
    const rows = await sql<{ __id: string; order_value: number | null }>`
      SELECT __id, ${sql.ref(viewOrderColumn)} as order_value
      FROM ${sql.table(fullTableName)}
    `.execute(db);

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.__id).toBe(emptyRecord.id().toString());
    expect(rows.rows[0]?.order_value).toBe(1);
  });
});
