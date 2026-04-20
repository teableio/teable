/* eslint-disable require-yield */
import { PGlite } from '@electric-sql/pglite';
import {
  ActorId,
  BaseId,
  DbFieldName,
  FieldName,
  RecordByIdsSpec,
  RecordId,
  Table,
  TableId,
  TableName,
  ViewName,
  buildRecordConditionSpec,
  ok,
} from '@teable/v2-core';
import type { IHasher, ILogger, IRecordOrderCalculator } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Dialect, QueryResult } from 'kysely';
import {
  CompiledQuery,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
} from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

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

class PGliteDriver {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  async acquireConnection() {
    return new PGliteConnection(this.#client);
  }

  async beginTransaction(connection: PGliteConnection) {
    await connection.executeQuery(CompiledQuery.raw('BEGIN'));
  }

  async commitTransaction(connection: PGliteConnection) {
    await connection.executeQuery(CompiledQuery.raw('COMMIT'));
  }

  async rollbackTransaction(connection: PGliteConnection) {
    await connection.executeQuery(CompiledQuery.raw('ROLLBACK'));
  }

  async destroy() {
    await this.#client.close();
  }

  async init() {}

  async releaseConnection() {}
}

class PGliteConnection {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const result = await this.#client.query<R>(compiledQuery.sql, [...compiledQuery.parameters]);
    return {
      rows: result.rows,
      numAffectedRows: result.affectedRows ? BigInt(result.affectedRows) : undefined,
    };
  }

  async *streamQuery(): AsyncGenerator<never> {
    throw new Error('PGlite does not support streaming.');
  }
}

class KyselyPGliteDialect implements Dialect {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  createAdapter() {
    return new PostgresAdapter();
  }

  createDriver() {
    return new PGliteDriver(this.#client);
  }

  createIntrospector(db: Kysely<unknown>) {
    return new PostgresIntrospector(db);
  }

  createQueryCompiler() {
    return new PostgresQueryCompiler();
  }
}

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
  const plan = {
    baseId: table.baseId(),
    seedTableId: table.id(),
    seedRecordIds: [],
    extraSeedRecords: [],
    steps: [],
    edges: [],
    estimatedComplexity: 0,
    changeType: 'update' as const,
  };
  return {
    plan: async () => ok(plan),
    planStage: async () => ok(plan),
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
    createNoopEventBus(),
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
  titleFieldId: string;
  amountFieldId: string;
  statusFieldId: string;
}> => {
  const baseId = BaseId.create(createId('bse', seed))._unsafeUnwrap();
  const tableId = TableId.create(createId('tbl', seed))._unsafeUnwrap();

  const builder = Table.builder()
    .withBaseId(baseId)
    .withId(tableId)
    .withName(TableName.create(`UpdateMany-${seed}`)._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.field().number().withName(FieldName.create('Amount')._unsafeUnwrap()).done();
  builder.field().singleLineText().withName(FieldName.create('Status')._unsafeUnwrap()).done();
  builder.view().grid().withName(ViewName.create('Grid')._unsafeUnwrap()).done();
  const table = builder.build()._unsafeUnwrap();

  const [titleField, amountField, statusField] = table.getFields();
  titleField!.setDbFieldName(DbFieldName.rehydrate('col_title')._unsafeUnwrap())._unsafeUnwrap();
  amountField!.setDbFieldName(DbFieldName.rehydrate('col_amount')._unsafeUnwrap())._unsafeUnwrap();
  statusField!.setDbFieldName(DbFieldName.rehydrate('col_status')._unsafeUnwrap())._unsafeUnwrap();

  const schemaName = baseId.toString();
  const tableName = tableId.toString();
  const fullTableName = `${schemaName}.${tableName}`;

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
      col_title text,
      col_amount double precision,
      col_status text
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
    titleFieldId: titleField!.id().toString(),
    amountFieldId: amountField!.id().toString(),
    statusFieldId: statusField!.id().toString(),
  };
};

describe('PostgresTableRecordRepository.updateMany (pglite)', () => {
  let pglite: PGlite;
  let db: Kysely<V1TeableDatabase>;
  const createdSchemas: string[] = [];

  beforeAll(async () => {
    pglite = await PGlite.create();
    db = new Kysely<V1TeableDatabase>({
      dialect: new KyselyPGliteDialect(pglite),
    });

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
    await db.destroy();
  });

  it('updates matching rows with a single update-set-where statement', async () => {
    const { table, schemaName, tableName, amountFieldId, statusFieldId } =
      await createTableWithStorage(db, 'update-many');
    createdSchemas.push(schemaName);

    const fullTableName = `${schemaName}.${tableName}`;
    const recordA = createId('rec', 'update-many-a');
    const recordB = createId('rec', 'update-many-b');
    const actorId = ActorId.create('tester')._unsafeUnwrap();

    await sql`
      INSERT INTO ${sql.table(fullTableName)} (
        __id,
        __created_time,
        __created_by,
        __last_modified_time,
        __last_modified_by,
        __version,
        col_title,
        col_amount,
        col_status
      )
      VALUES
        (
          ${recordA},
          NOW(),
          'seed',
          NOW(),
          'seed',
          1,
          'Low',
          2,
          'Open'
        ),
        (
          ${recordB},
          NOW(),
          'seed',
          NOW(),
          'seed',
          3,
          'High',
          10,
          'Open'
        )
    `.execute(db);

    const filterSpec = buildRecordConditionSpec(table, {
      fieldId: amountFieldId,
      operator: 'isGreater',
      value: 5,
    })._unsafeUnwrap();

    const mutateSpec = table
      .updateRecord(RecordId.create(recordA)._unsafeUnwrap(), new Map([[statusFieldId, 'Done']]))
      ._unsafeUnwrap().mutateSpec;

    const repository = createRepository(db as unknown as Kysely<DynamicDB>, table);
    const result = await repository.updateMany({ actorId }, table, filterSpec, mutateSpec);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().totalUpdated).toBe(1);
    expect(result._unsafeUnwrap().updatedRecordIds.map((recordId) => recordId.toString())).toEqual([
      recordB,
    ]);
    expect(
      result._unsafeUnwrap().updatedRecords.map((record) => ({
        recordId: record.recordId.toString(),
        oldVersion: record.oldVersion,
        newVersion: record.newVersion,
        oldFieldValues: record.oldFieldValues,
      }))
    ).toEqual([
      {
        recordId: recordB,
        oldVersion: 3,
        newVersion: 4,
        oldFieldValues: {
          [statusFieldId]: 'Open',
        },
      },
    ]);

    const rows = await sql<{
      __id: string;
      col_status: string | null;
      __version: number;
      __last_modified_by: string;
    }>`
      SELECT __id, col_status, __version, __last_modified_by
      FROM ${sql.table(fullTableName)}
      ORDER BY __id
    `.execute(db);

    expect(rows.rows).toEqual([
      {
        __id: recordA,
        col_status: 'Open',
        __version: 1,
        __last_modified_by: 'seed',
      },
      {
        __id: recordB,
        col_status: 'Done',
        __version: 4,
        __last_modified_by: 'tester',
      },
    ]);
  });

  it('updates explicit recordIds without touching other rows', async () => {
    const { table, schemaName, tableName, statusFieldId } = await createTableWithStorage(
      db,
      'update-many-ids'
    );
    createdSchemas.push(schemaName);

    const fullTableName = `${schemaName}.${tableName}`;
    const recordA = createId('rec', 'ids-a');
    const recordB = createId('rec', 'ids-b');
    const recordC = createId('rec', 'ids-c');
    const actorId = ActorId.create('tester')._unsafeUnwrap();

    await sql`
      INSERT INTO ${sql.table(fullTableName)} (
        __id,
        __created_time,
        __created_by,
        __last_modified_time,
        __last_modified_by,
        __version,
        col_title,
        col_amount,
        col_status
      )
      VALUES
        (${recordA}, NOW(), 'seed', NOW(), 'seed', 1, 'Alpha', 1, 'Open'),
        (${recordB}, NOW(), 'seed', NOW(), 'seed', 2, 'Beta', 2, 'Open'),
        (${recordC}, NOW(), 'seed', NOW(), 'seed', 3, 'Gamma', 3, 'Open')
    `.execute(db);

    const targetSpec = RecordByIdsSpec.create([
      RecordId.create(recordA)._unsafeUnwrap(),
      RecordId.create(recordC)._unsafeUnwrap(),
    ]);
    const mutateSpec = table
      .updateRecord(RecordId.create(recordA)._unsafeUnwrap(), new Map([[statusFieldId, 'Done']]))
      ._unsafeUnwrap().mutateSpec;

    const repository = createRepository(db as unknown as Kysely<DynamicDB>, table);
    const result = await repository.updateMany({ actorId }, table, targetSpec, mutateSpec);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().totalUpdated).toBe(2);
    expect(result._unsafeUnwrap().updatedRecordIds.map((recordId) => recordId.toString())).toEqual([
      recordA,
      recordC,
    ]);

    const rows = await sql<{
      __id: string;
      col_status: string | null;
      __version: number;
    }>`
      SELECT __id, col_status, __version
      FROM ${sql.table(fullTableName)}
      ORDER BY __id
    `.execute(db);

    expect(rows.rows).toEqual([
      {
        __id: recordA,
        col_status: 'Done',
        __version: 2,
      },
      {
        __id: recordB,
        col_status: 'Open',
        __version: 2,
      },
      {
        __id: recordC,
        col_status: 'Done',
        __version: 4,
      },
    ]);
  });

  it('does not update selector-matched rows when requested values are unchanged', async () => {
    const { table, schemaName, tableName, statusFieldId } = await createTableWithStorage(
      db,
      'update-many-noop'
    );
    createdSchemas.push(schemaName);

    const fullTableName = `${schemaName}.${tableName}`;
    const recordId = createId('rec', 'noop-selector');
    const actorId = ActorId.create('tester')._unsafeUnwrap();

    await sql`
      INSERT INTO ${sql.table(fullTableName)} (
        __id,
        __created_time,
        __created_by,
        __last_modified_time,
        __last_modified_by,
        __version,
        col_title,
        col_amount,
        col_status
      )
      VALUES (${recordId}, NOW(), 'seed', NOW(), 'seed', 1, 'Alpha', 1, 'Open')
    `.execute(db);

    const targetSpec = RecordByIdsSpec.create([RecordId.create(recordId)._unsafeUnwrap()]);
    const mutateSpec = table
      .updateRecord(RecordId.create(recordId)._unsafeUnwrap(), new Map([[statusFieldId, 'Open']]))
      ._unsafeUnwrap().mutateSpec;

    const repository = createRepository(db as unknown as Kysely<DynamicDB>, table);
    const result = await repository.updateMany({ actorId }, table, targetSpec, mutateSpec);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchObject({
      totalUpdated: 0,
      updatedRecordIds: [],
      updatedRecords: [],
    });

    const rows = await sql<{
      __id: string;
      col_status: string | null;
      __version: number;
      __last_modified_by: string;
    }>`
      SELECT __id, col_status, __version, __last_modified_by
      FROM ${sql.table(fullTableName)}
      ORDER BY __id
    `.execute(db);

    expect(rows.rows).toEqual([
      {
        __id: recordId,
        col_status: 'Open',
        __version: 1,
        __last_modified_by: 'seed',
      },
    ]);
  });

  it('does not update explicit stream rows when requested values are unchanged', async () => {
    const { table, schemaName, tableName, statusFieldId } = await createTableWithStorage(
      db,
      'update-stream-noop'
    );
    createdSchemas.push(schemaName);

    const fullTableName = `${schemaName}.${tableName}`;
    const recordId = createId('rec', 'noop-stream');
    const actorId = ActorId.create('tester')._unsafeUnwrap();
    const typedRecordId = RecordId.create(recordId)._unsafeUnwrap();

    await sql`
      INSERT INTO ${sql.table(fullTableName)} (
        __id,
        __created_time,
        __created_by,
        __last_modified_time,
        __last_modified_by,
        __version,
        col_title,
        col_amount,
        col_status
      )
      VALUES (${recordId}, NOW(), 'seed', NOW(), 'seed', 1, 'Alpha', 1, 'Open')
    `.execute(db);

    const updateResult = table
      .updateRecord(typedRecordId, new Map([[statusFieldId, 'Open']]))
      ._unsafeUnwrap();
    const repository = createRepository(db as unknown as Kysely<DynamicDB>, table);
    const result = await repository.updateManyStream(
      { actorId },
      table,
      (function* () {
        yield ok([updateResult]);
      })()
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ totalUpdated: 0, updatedRecords: [] });

    const rows = await sql<{
      __id: string;
      col_status: string | null;
      __version: number;
      __last_modified_by: string;
    }>`
      SELECT __id, col_status, __version, __last_modified_by
      FROM ${sql.table(fullTableName)}
      ORDER BY __id
    `.execute(db);

    expect(rows.rows).toEqual([
      {
        __id: recordId,
        col_status: 'Open',
        __version: 1,
        __last_modified_by: 'seed',
      },
    ]);
  });
});
