/* eslint-disable require-yield */
import { PostgresUnitOfWorkTransaction } from '@teable/v2-adapter-db-postgres-shared';
import {
  ActorId,
  BaseId,
  DbFieldName,
  FieldId,
  type IHasher,
  type ILogger,
  type IRecordOrderCalculator,
  type IExecutionContext,
  type ITableRepository,
  type RecordRestoreSystemValues,
  RecordByIdsSpec,
  SetRowOrderValueSpec,
  FieldName,
  Table,
  TableId,
  TableName,
  ViewName,
  ok,
} from '@teable/v2-core';
import { Pg16TypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createPGliteDb } from '../../schema/visitors/__tests__/helpers/createPGliteDb';
import { installUndoCaptureGlobals } from '../../schema/visitors/__tests__/helpers/installUndoCaptureGlobals';
import { ACTOR_COLUMNS } from '../actorColumns';
import type {
  ComputedFieldUpdater,
  ComputedUpdatePlanner,
  IComputedUpdateOutbox,
  IUpdateStrategy,
} from '../computed';
import { TableRecordQueryBuilderManager, type DynamicDB } from '../query-builder';
import { buildBatchUpdateSql } from '../query-builder/update/BatchUpdateSqlBuilder';
import { createNoopEventBus } from './__tests__/helpers/createNoopEventBus';
import { PostgresRecordMutationSnapshotCaptureService } from './PostgresRecordMutationSnapshotCaptureService';
import { PostgresTableRecordQueryRepository } from './PostgresTableRecordQueryRepository';
import { PostgresTableRecordRepository } from './PostgresTableRecordRepository';

const sanitizeIdSeed = (seed: string): string => seed.replace(/[^0-9a-z]/gi, '0');
const createId = (prefix: string, seed: string): string =>
  `${prefix}${sanitizeIdSeed(seed).padEnd(16, '0').slice(0, 16)}`;
const POSTGRES_BIND_PARAMETER_LIMIT = 65_535;

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
    hasWritableComputedWork: () => true,
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
  seed: string,
  actorStorageVersion = 0
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
  const builtTable = builder.build()._unsafeUnwrap();
  const table = Table.rehydrate({
    id: builtTable.id(),
    baseId: builtTable.baseId(),
    name: builtTable.name(),
    fields: builtTable.getFields(),
    views: builtTable.views(),
    primaryFieldId: builtTable.primaryFieldId(),
    dbTableName: builtTable.dbTableName()._unsafeUnwrap(),
    actorStorageVersion,
  })._unsafeUnwrap();

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
  if (actorStorageVersion === 1) {
    await sql`ALTER TABLE ${sql.table(fullTableName)}
      ADD COLUMN __created_by_actor_type text,
      ADD COLUMN __created_by_actor_id text,
      ADD COLUMN __last_modified_by_actor_type text,
      ADD COLUMN __last_modified_by_actor_id text`.execute(db);
  }

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

const createWideTableWithStorage = async (
  db: Kysely<V1TeableDatabase>,
  seed: string,
  fieldCount: number
): Promise<{
  table: Table;
  schemaName: string;
  tableName: string;
  fieldIds: string[];
}> => {
  const baseId = BaseId.create(createId('bse', seed))._unsafeUnwrap();
  const tableId = TableId.create(createId('tbl', seed))._unsafeUnwrap();

  const builder = Table.builder()
    .withBaseId(baseId)
    .withId(tableId)
    .withName(TableName.create(`Wide Insert-${seed}`)._unsafeUnwrap());

  for (let i = 0; i < fieldCount; i++) {
    const fieldBuilder = builder
      .field()
      .singleLineText()
      .withId(FieldId.create(`fld${String(i).padStart(16, '0')}`)._unsafeUnwrap())
      .withName(FieldName.create(`Column ${i}`)._unsafeUnwrap());
    if (i === 0) {
      fieldBuilder.primary();
    }
    fieldBuilder.done();
  }
  builder.view().grid().withName(ViewName.create('Grid')._unsafeUnwrap()).done();

  const table = builder.build()._unsafeUnwrap();
  const fields = table.getFields();
  for (let i = 0; i < fields.length; i++) {
    fields[i]!.setDbFieldName(DbFieldName.rehydrate(`col_${i}`)._unsafeUnwrap())._unsafeUnwrap();
  }

  const schemaName = baseId.toString();
  const tableName = tableId.toString();
  const fullTableName = `${schemaName}.${tableName}`;
  const viewOrderColumn = table.views()[0]!.id().toRowOrderColumnName();
  const fieldColumnDefinitions = sql.join(
    fields.map((_, i) => sql`${sql.id(`col_${i}`)} text`),
    sql`, `
  );

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
      ${fieldColumnDefinitions}
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
    fieldIds: fields.map((field) => field.id().toString()),
  };
};

describe('PostgresTableRecordRepository.insert (pglite)', () => {
  let db: Kysely<V1TeableDatabase>;
  let pglite: Awaited<ReturnType<typeof createPGliteDb>>['pglite'];
  let destroyDb: (() => Promise<void>) | undefined;
  const createdSchemas: string[] = [];

  beforeAll(async () => {
    const pgliteDb = await createPGliteDb();
    db = pgliteDb.db;
    pglite = pgliteDb.pglite;
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
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY,
        name text,
        email text
      )
    `.execute(db);
    await sql`
      INSERT INTO users (id, name, email)
      VALUES ('usr_native', 'Original creator', 'original@example.com')
      ON CONFLICT (id) DO NOTHING
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

  it.each([0, 1])(
    'persists native CRUD and nullable actor values for capability %s',
    async (version) => {
      const { table, schemaName, tableName, primaryFieldId } = await createTableWithStorage(
        db,
        `actor-crud-${version}`,
        version
      );
      createdSchemas.push(schemaName);
      const repository = createRepository(db as unknown as Kysely<DynamicDB>, table);
      const queryRepository = new PostgresTableRecordQueryRepository(
        new TableRecordQueryBuilderManager(
          db,
          {} as ITableRepository,
          new Pg16TypeValidationStrategy()
        ),
        db,
        createLogger()
      );
      const context: IExecutionContext & { actorName: string; actorEmail: string } = {
        actorId: ActorId.create('robot')._unsafeUnwrap(),
        actorName: 'Robot',
        actorEmail: 'robot@example.com',
        initiator: { type: 'appUser', id: 'apu_customer_a' },
      };
      const unknown: IExecutionContext = { actorId: context.actorId };
      const user: IExecutionContext = {
        ...context,
        initiator: { type: 'user', id: 'usr_editor_b' },
      };
      const record = table
        .createRecord(new Map([[primaryFieldId, 'Alpha']]))
        ._unsafeUnwrap().record;
      const transaction = <T>(
        work: (ctx: IExecutionContext) => Promise<T>,
        ctx: IExecutionContext = context
      ) =>
        db
          .transaction()
          .execute((trx) =>
            work({ ...ctx, transaction: new PostgresUnitOfWorkTransaction(trx as never) })
          );
      const inserted = (
        await transaction((ctx) => repository.insert(ctx, table, record))
      )._unsafeUnwrap();
      expect(inserted.recordActors).toEqual({
        createdByActorType: version ? 'appUser' : null,
        createdByActorId: version ? 'apu_customer_a' : null,
        lastModifiedByActorType: version ? 'appUser' : null,
        lastModifiedByActorId: version ? 'apu_customer_a' : null,
      });
      const read = async (mode: 'stored' | 'computed') =>
        (await queryRepository.findOne(context, table, record.id(), { mode }))._unsafeUnwrap();
      for (const mode of ['stored', 'computed'] as const) {
        expect(await read(mode)).toMatchObject({
          createdByActorType: version ? 'appUser' : null,
          createdByActorId: version ? 'apu_customer_a' : null,
          lastModifiedByActorType: version ? 'appUser' : null,
          lastModifiedByActorId: version ? 'apu_customer_a' : null,
        });
      }
      const update = (value: string, ctx: IExecutionContext) =>
        transaction(
          (tx) =>
            repository.updateOne(
              tx,
              table,
              record.id(),
              table.updateRecord(record.id(), new Map([[primaryFieldId, value]]))._unsafeUnwrap()
                .mutateSpec
            ),
          ctx
        );
      const mutated = (await update('Beta', user))._unsafeUnwrap();
      expect(mutated.recordActors).toEqual({
        createdByActorType: version ? 'appUser' : null,
        createdByActorId: version ? 'apu_customer_a' : null,
        lastModifiedByActorType: version ? 'user' : null,
        lastModifiedByActorId: version ? 'usr_editor_b' : null,
      });
      const beforeNoop = await sql<
        Record<string, unknown>
      >`SELECT * FROM ${sql.table(`${schemaName}.${tableName}`)}`.execute(db);
      const noop = (await update('Beta', unknown))._unsafeUnwrap();
      expect(noop.mutationApplied).toBe(false);
      expect(noop.recordActors).toEqual(mutated.recordActors);
      const afterNoop = await sql<
        Record<string, unknown>
      >`SELECT * FROM ${sql.table(`${schemaName}.${tableName}`)}`.execute(db);
      expect(afterNoop.rows).toEqual(beforeNoop.rows);
      if (version) {
        expect(beforeNoop.rows[0]).toMatchObject({
          __created_by: 'robot',
          __last_modified_by: 'robot',
          __created_by_actor_type: 'appUser',
          __created_by_actor_id: 'apu_customer_a',
          __last_modified_by_actor_type: 'user',
          __last_modified_by_actor_id: 'usr_editor_b',
        });
      } else {
        expect(beforeNoop.rows[0]).not.toHaveProperty('__created_by_actor_type');
      }
      expect(
        (
          await transaction(
            (ctx) =>
              repository.updateOne(
                ctx,
                table,
                record.id(),
                new SetRowOrderValueSpec(table.views()[0]!.id(), 70)
              ),
            unknown
          )
        ).isOk()
      ).toBe(true);
      expect(await read('stored')).toMatchObject({
        createdByActorId: version ? 'apu_customer_a' : null,
        lastModifiedByActorId: version ? 'usr_editor_b' : null,
      });
      expect((await update('Gamma', unknown)).isOk()).toBe(true);
      expect(await read('stored')).toMatchObject({
        createdByActorId: version ? 'apu_customer_a' : null,
        lastModifiedByActorType: null,
        lastModifiedByActorId: null,
      });
      const target = RecordByIdsSpec.create([record.id()]);
      const bulkMutation = table
        .updateRecord(record.id(), new Map([[primaryFieldId, 'Bulk']]))
        ._unsafeUnwrap().mutateSpec;
      const bulk = (
        await transaction((ctx) => repository.updateMany(ctx, table, target, bulkMutation), user)
      )._unsafeUnwrap();
      expect(bulk.totalUpdated).toBe(1);
      expect(bulk.recordActorsByRecord?.get(record.id().toString())).toEqual(mutated.recordActors);
      expect(await read('stored')).toMatchObject({
        lastModifiedByActorId: version ? 'usr_editor_b' : null,
      });
      const bulkNoop = (
        await transaction((ctx) => repository.updateMany(ctx, table, target, bulkMutation), unknown)
      )._unsafeUnwrap();
      expect(bulkNoop.totalUpdated).toBe(0);
      expect(bulkNoop.recordActorsByRecord?.get(record.id().toString())).toEqual(
        mutated.recordActors
      );
      expect(await read('stored')).toMatchObject({
        lastModifiedByActorId: version ? 'usr_editor_b' : null,
      });
      const deleted = (
        await transaction((ctx) => repository.deleteMany(ctx, table, target))
      )._unsafeUnwrap();
      expect(deleted.deletedRecords).toHaveLength(1);
      expect(deleted.deletedRecords?.[0]).toMatchObject({
        recordId: record.id().toString(),
        createdByActorId: version ? 'apu_customer_a' : null,
        lastModifiedByActorId: version ? 'usr_editor_b' : null,
      });
      expect(
        (await sql`SELECT * FROM ${sql.table(`${schemaName}.${tableName}`)}`.execute(db)).rows
      ).toEqual([]);
      // A later deletion cannot change the response afterimage already frozen by SQL.
      expect(inserted.recordActors?.createdByActorId).toBe(version ? 'apu_customer_a' : null);
      expect(mutated.recordActors?.lastModifiedByActorId).toBe(version ? 'usr_editor_b' : null);
    }
  );

  it('attributes batch/stream inserts and mutations and protects restore attribution', async () => {
    const { table, schemaName, tableName, primaryFieldId } = await createTableWithStorage(
      db,
      'actor-stream',
      1
    );
    createdSchemas.push(schemaName);
    const repository = createRepository(db as unknown as Kysely<DynamicDB>, table);
    const context: IExecutionContext & { actorName: string; actorEmail: string } = {
      actorId: ActorId.create('robot')._unsafeUnwrap(),
      initiator: { type: 'appUser', id: 'apu_live' },
      actorName: 'Robot',
      actorEmail: 'robot@example.com',
    };
    const records = ['batch', 'stream', 'restored', 'old-restore', 'imported', 'forged'].map(
      (name) => table.createRecord(new Map([[primaryFieldId, name]]))._unsafeUnwrap().record
    );
    const transaction = <T>(
      work: (ctx: IExecutionContext) => Promise<T>,
      ctx: IExecutionContext = context
    ) =>
      db
        .transaction()
        .execute((trx) =>
          work({ ...ctx, transaction: new PostgresUnitOfWorkTransaction(trx as never) })
        );
    const insertedBatch = (
      await transaction((ctx) => repository.insertMany(ctx, table, [records[0]!]))
    )._unsafeUnwrap();
    expect(insertedBatch.recordActorsByRecord?.get(records[0]!.id().toString())).toMatchObject({
      createdByActorId: 'apu_live',
      lastModifiedByActorId: 'apu_live',
    });
    expect(
      (await transaction((ctx) => repository.insertManyStream(ctx, table, [[records[1]!]]))).isOk()
    ).toBe(true);
    const restoreRecordsById = new Map<string, RecordRestoreSystemValues>([
      [records[2]!.id().toString(), { createdByActor: { type: 'user', id: 'usr_original' } }],
      [records[3]!.id().toString(), { createdByActor: null }],
      [records[4]!.id().toString(), { createdBy: 'robot' }],
    ]);
    expect(
      (
        await transaction((ctx) =>
          repository.insertMany(ctx, table, records.slice(2, 5), { restoreRecordsById })
        )
      ).isOk()
    ).toBe(true);
    for (const column of ACTOR_COLUMNS) {
      const forgedOptions = {
        restoreRecordsById: new Map([
          [records[5]!.id().toString(), { extraColumnValues: { [column]: 'forged' } }],
        ]),
      };
      expect(
        (
          await transaction((ctx) =>
            repository.insertMany(ctx, table, [records[5]!], forgedOptions)
          )
        ).isErr()
      ).toBe(true);
      expect(
        (
          await transaction((ctx) => repository.insert(ctx, table, records[5]!, forgedOptions))
        ).isErr()
      ).toBe(true);
    }
    const selectRows = async () =>
      (
        await sql<
          Record<string, unknown>
        >`SELECT * FROM ${sql.table(`${schemaName}.${tableName}`)} ORDER BY __auto_number`.execute(
          db
        )
      ).rows;
    const created = await selectRows();
    expect(created.map((row) => row.__created_by_actor_id)).toEqual([
      'apu_live',
      'apu_live',
      'usr_original',
      null,
      'apu_live',
    ]);
    expect(created.map((row) => row.__last_modified_by_actor_id)).toEqual(
      Array(5).fill('apu_live')
    );
    const nativeRestore = table
      .createRecord(new Map([[primaryFieldId, 'native-restore']]))
      ._unsafeUnwrap().record;
    const nativeRestoreResult = await transaction(async (ctx) => {
      const restored = await repository.insert(ctx, table, nativeRestore, {
        restoreRecordsById: new Map([
          [
            nativeRestore.id().toString(),
            {
              version: 7,
              autoNumber: 777,
              createdTime: '2020-01-02T03:04:05.000Z',
              createdBy: 'usr_native',
              createdByActor: { type: 'system', id: 'svc_restore' },
            },
          ],
        ]),
      });
      // Surface the original repository error before transaction commit can mask it.
      return restored._unsafeUnwrap();
    });
    expect(nativeRestoreResult.recordSnapshot).toMatchObject({
      version: 7,
      autoNumber: 777,
      createdBy: 'usr_native',
      createdByActorType: 'system',
      createdByActorId: 'svc_restore',
      lastModifiedByActorId: 'apu_live',
    });
    const [restoredRow] = (
      await sql<Record<string, unknown>>`
      SELECT * FROM ${sql.table(`${schemaName}.${tableName}`)} WHERE __id = ${nativeRestore.id().toString()}
    `.execute(db)
    ).rows;
    expect(restoredRow).toMatchObject({
      __version: 7,
      __auto_number: 777,
      __created_by: 'usr_native',
      __created_by_actor_type: 'system',
      __created_by_actor_id: 'svc_restore',
      __last_modified_by_actor_type: 'appUser',
      __last_modified_by_actor_id: 'apu_live',
    });
    expect(new Date(restoredRow!.__created_time as string | Date).toISOString()).toBe(
      '2020-01-02T03:04:05.000Z'
    );
    const mixedOrder = buildBatchUpdateSql({
      table,
      tableName: `${schemaName}.${tableName}`,
      db: db as unknown as Kysely<DynamicDB>,
      initiator: { type: 'user', id: 'usr_mixed' },
      systemColumns: {
        lastModifiedTime: '2026-01-01T00:00:00.000Z',
        lastModifiedBy: 'robot',
        versionIncrement: true,
      },
      columnUpdateData: new Map<string, Array<{ recordId: string; value: unknown }>>([
        ['col_name', [{ recordId: records[0]!.id().toString(), value: 'mixed-field' }]],
        [
          table.views()[0]!.id().toRowOrderColumnName(),
          [{ recordId: records[1]!.id().toString(), value: 50 }],
        ],
      ]),
    })._unsafeUnwrap();
    await db.executeQuery(mixedOrder);
    expect((await selectRows()).slice(0, 2).map((row) => row.__last_modified_by_actor_id)).toEqual([
      'usr_mixed',
      'apu_live',
    ]);
    const updates = records
      .slice(0, 2)
      .map((record) =>
        table.updateRecord(record.id(), new Map([[primaryFieldId, 'changed']]))._unsafeUnwrap()
      );
    const streamMutation = (
      await transaction(
        (ctx) =>
          repository.updateManyStream(
            ctx,
            table,
            (function* () {
              yield ok(updates);
            })()
          ),
        {
          ...context,
          initiator: { type: 'automation', id: 'workflow_stable' },
        }
      )
    )._unsafeUnwrap();
    expect(
      [...streamMutation.recordActorsByRecord!.values()].map((actor) => actor.lastModifiedByActorId)
    ).toEqual(['workflow_stable', 'workflow_stable']);
    const modified = await selectRows();
    expect(modified.slice(0, 2).map((row) => row.__last_modified_by_actor_id)).toEqual([
      'workflow_stable',
      'workflow_stable',
    ]);
    const streamNoop = (
      await transaction(
        (ctx) =>
          repository.updateManyStream(
            ctx,
            table,
            (function* () {
              yield ok(updates);
            })()
          ),
        { actorId: context.actorId }
      )
    )._unsafeUnwrap();
    expect(streamNoop.totalUpdated).toBe(0);
    expect(streamNoop.recordActorsByRecord).toEqual(streamMutation.recordActorsByRecord);
    expect(await selectRows()).toEqual(modified);
    const clearedUpdates = records
      .slice(0, 2)
      .map((record) =>
        table.updateRecord(record.id(), new Map([[primaryFieldId, null]]))._unsafeUnwrap()
      );
    expect(
      (
        await transaction(
          (ctx) =>
            repository.updateManyStream(
              ctx,
              table,
              (function* () {
                yield ok(clearedUpdates);
              })()
            ),
          { actorId: context.actorId }
        )
      ).isOk()
    ).toBe(true);
    expect(
      (await selectRows())
        .slice(0, 2)
        .map((row) => [row.__last_modified_by_actor_type, row.__last_modified_by_actor_id])
    ).toEqual([
      [null, null],
      [null, null],
    ]);
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

  it('splits wide insertMany batches under the PostgreSQL bind parameter limit', async () => {
    const fieldCount = 172;
    const recordCount = 500;
    const { table, schemaName, tableName, fieldIds } = await createWideTableWithStorage(
      db,
      'wide-bind-limit',
      fieldCount
    );
    createdSchemas.push(schemaName);

    const repository = createRepository(db as unknown as Kysely<DynamicDB>, table);
    const actorId = ActorId.create('tester')._unsafeUnwrap();
    const actorContext = {
      actorId,
      actorName: 'Tester',
      actorEmail: 'tester@example.com',
    };
    const records = Array.from({ length: recordCount }, (_, recordIndex) => {
      const values = new Map(
        fieldIds.map((fieldId, fieldIndex) => [fieldId, `r${recordIndex}-c${fieldIndex}`])
      );
      return table.createRecord(values)._unsafeUnwrap().record;
    });

    const client = pglite as unknown as {
      query: (query: string, params?: unknown[], options?: unknown) => Promise<unknown>;
    };
    const originalQuery = client.query.bind(client);
    const mainInsertParameterCounts: number[] = [];
    client.query = async (query, params, options) => {
      const parameterCount = params?.length ?? 0;
      const isMainTableInsert =
        query.startsWith('insert into') && query.includes(`"${schemaName}"."${tableName}"`);
      if (isMainTableInsert) {
        mainInsertParameterCounts.push(parameterCount);
      }
      if (parameterCount > POSTGRES_BIND_PARAMETER_LIMIT) {
        throw new Error(`PostgreSQL bind parameter limit exceeded in test: ${parameterCount}`);
      }
      return originalQuery(query, params, options);
    };

    try {
      const result = await db
        .transaction()
        .execute(async (trx) =>
          repository.insertMany(
            { ...actorContext, transaction: new PostgresUnitOfWorkTransaction(trx as never) },
            table,
            records,
            { skipSnapshotCapture: true, skipChangedFields: true, skipComputedUpdates: true }
          )
        );
      const resultErrorMessage = result.isErr()
        ? [
            result._unsafeUnwrapErr().message,
            `main insert parameter counts: ${mainInsertParameterCounts.join(', ')}`,
          ].join('; ')
        : undefined;
      expect(result.isOk(), resultErrorMessage).toBe(true);
    } finally {
      client.query = originalQuery;
    }

    expect(mainInsertParameterCounts.length).toBeGreaterThan(1);
    expect(Math.max(...mainInsertParameterCounts)).toBeLessThanOrEqual(
      POSTGRES_BIND_PARAMETER_LIMIT
    );

    const fullTableName = `${schemaName}.${tableName}`;
    const rows = await sql<{ count: string }>`
      SELECT COUNT(*)::text AS count
      FROM ${sql.table(fullTableName)}
    `.execute(db);
    expect(Number(rows.rows[0]?.count ?? '0')).toBe(recordCount);
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
