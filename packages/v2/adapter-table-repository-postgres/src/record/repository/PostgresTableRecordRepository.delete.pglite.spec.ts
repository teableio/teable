import {
  ActorId,
  BaseId,
  DbFieldName,
  FieldName,
  type IHasher,
  type ILogger,
  type IRecordOrderCalculator,
  RecordId,
  Table,
  TableId,
  TableName,
  TableRecord,
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

const createNoopComputedPlanner = (table: Table): ComputedUpdatePlanner =>
  ({
    plan: async () =>
      ok({
        baseId: table.baseId(),
        seedTableId: table.id(),
        seedRecordIds: [],
        extraSeedRecords: [],
        steps: [],
        edges: [],
        estimatedComplexity: 0,
        changeType: 'delete',
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
        changeType: 'delete',
      }),
    resolveBeforeImageRequirements: async () =>
      ok({
        needsBeforeImage: false,
        requiredFieldIds: [],
      }),
    hasWritableComputedWork: () => true,
  }) as unknown as ComputedUpdatePlanner;

const createNoopStrategy = (): IUpdateStrategy => ({
  mode: 'sync',
  name: 'noop',
  execute: async () => ok(undefined),
  scheduleDispatch: () => undefined,
});

const createNoopOutbox = (): IComputedUpdateOutbox =>
  ({
    enqueueOrMerge: async () => ok({ taskId: 'test', merged: false }),
    enqueueSeedTask: async () => ok({ taskId: 'test', merged: false }),
    enqueueFieldBackfill: async () => ok({ taskId: 'test', merged: false }),
    claimBatch: async () => ok([]),
    claimById: async () => ok(null),
    renewLease: async () => ok([]),
    markDone: async () => ok(true),
    markFailed: async () => ok(true),
  }) as IComputedUpdateOutbox;
const createNoopHasher = (): IHasher => ({
  sha256: () => 'test-hash',
});

const createNoopRecordOrderCalculator = (): IRecordOrderCalculator => ({
  calculateOrders: async () => ok([]),
});

const createRepository = (db: Kysely<DynamicDB>, table: Table) => {
  const logger = createLogger();
  return new PostgresTableRecordRepository(
    db as unknown as Kysely<V1TeableDatabase>,
    logger,
    createNoopRecordOrderCalculator(),
    createNoopComputedPlanner(table),
    {} as ComputedFieldUpdater,
    createNoopStrategy(),
    createNoopOutbox(),
    new PostgresRecordMutationSnapshotCaptureService(
      db as unknown as Kysely<V1TeableDatabase>,
      logger
    ),
    createNoopEventBus(),
    createNoopHasher()
  );
};

describe('PostgresTableRecordRepository.delete (pglite)', () => {
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
        name text,
        base_id text,
        deleted_time timestamptz,
        last_modified_time timestamptz,
        last_modified_by text
      )
    `.execute(db);
    await sql`
      CREATE TABLE IF NOT EXISTS field (
        id text PRIMARY KEY,
        table_id text,
        name text,
        not_null boolean,
        db_field_name text,
        deleted_time timestamptz,
        type text,
        is_lookup boolean,
        options text
      )
    `.execute(db);
    await installUndoCaptureGlobals(db as never);
  });

  afterEach(async () => {
    for (const schemaName of createdSchemas) {
      await sql`DROP SCHEMA IF EXISTS ${sql.id(schemaName)} CASCADE`.execute(db);
    }
    createdSchemas.length = 0;
    await sql`DELETE FROM field`.execute(db);
    await sql`DELETE FROM table_meta`.execute(db);
  });

  afterAll(async () => {
    await destroyDb?.();
  });

  it('deletes records when a deleted incoming link column is already gone', async () => {
    const schemaName = createId('bse', 'del-missing-fk');
    const targetTableId = createId('tbl', 'target-a');
    const sourceTableId = createId('tbl', 'source-b');
    const linkFieldId = createId('fld', 'deleted-link');
    const recordId = createId('rec', 'alive-row');
    createdSchemas.push(schemaName);

    const builder = Table.builder()
      .withBaseId(BaseId.create(schemaName)._unsafeUnwrap())
      .withId(TableId.create(targetTableId)._unsafeUnwrap())
      .withName(TableName.create('Target')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().grid().withName(ViewName.create('Grid')._unsafeUnwrap()).done();
    const table = builder.build()._unsafeUnwrap();
    table
      .getFields()[0]!
      .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
      ._unsafeUnwrap();

    await sql`CREATE SCHEMA ${sql.id(schemaName)}`.execute(db);
    await sql`
      CREATE TABLE ${sql.id(schemaName)}.${sql.id(targetTableId)} (
        __id text PRIMARY KEY,
        __created_time timestamptz NOT NULL,
        __created_by text NOT NULL,
        __last_modified_time timestamptz NOT NULL,
        __last_modified_by text NOT NULL,
        __version integer NOT NULL,
        __auto_number serial NOT NULL,
        col_name text
      )
    `.execute(db);
    await sql`
      CREATE TABLE ${sql.id(schemaName)}.${sql.id(sourceTableId)} (
        __id text PRIMARY KEY,
        __created_time timestamptz NOT NULL,
        __created_by text NOT NULL,
        __last_modified_time timestamptz NOT NULL,
        __last_modified_by text NOT NULL,
        __version integer NOT NULL,
        __auto_number serial NOT NULL
      )
    `.execute(db);

    await sql`
      INSERT INTO ${sql.id(schemaName)}.${sql.id(targetTableId)}
        (__id, __created_time, __created_by, __last_modified_time, __last_modified_by, __version, col_name)
      VALUES (${recordId}, NOW(), 'tester', NOW(), 'tester', 1, 'Alice')
    `.execute(db);

    await sql`
      INSERT INTO table_meta (id, name, base_id, last_modified_time, last_modified_by)
      VALUES
        (${targetTableId}, 'Target', ${schemaName}, NOW(), 'seed'),
        (${sourceTableId}, 'Source', ${schemaName}, NOW(), 'seed')
    `.execute(db);
    await sql`
      INSERT INTO field (id, table_id, name, not_null, db_field_name, type, is_lookup, deleted_time, options)
      VALUES (
        ${linkFieldId},
        ${sourceTableId},
        'DeletedLink',
        false,
        'Link',
        'link',
        false,
        NOW(),
        ${JSON.stringify({
          relationship: 'manyOne',
          isOneWay: false,
          foreignTableId: targetTableId,
          fkHostTableName: `${schemaName}.${sourceTableId}`,
          selfKeyName: '__id',
          foreignKeyName: `__fk_${linkFieldId}`,
        })}
      )
    `.execute(db);

    const repository = createRepository(db as unknown as Kysely<DynamicDB>, table);
    const actorId = ActorId.create('tester')._unsafeUnwrap();
    const deleteSpec = TableRecord.specs('or')
      .recordId(RecordId.create(recordId)._unsafeUnwrap())
      .build()
      ._unsafeUnwrap();

    const result = await repository.deleteMany({ actorId }, table, deleteSpec);
    expect(result.isOk()).toBe(true);

    const remaining = await sql<{ cnt: string }>`
      SELECT count(*)::text AS cnt
      FROM ${sql.id(schemaName)}.${sql.id(targetTableId)}
    `.execute(db);
    expect(remaining.rows[0]?.cnt).toBe('0');

    await sql`SELECT 1`.execute(db);
  });
});
