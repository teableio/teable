/* eslint-disable require-yield */
import { PGlite } from '@electric-sql/pglite';
import {
  ActorId,
  BaseId,
  DbFieldName,
  FieldName,
  Table,
  TableId,
  TableName,
  ViewName,
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

import type {
  ComputedFieldUpdater,
  ComputedUpdatePlanner,
  IComputedUpdateOutbox,
  IUpdateStrategy,
} from '../computed';
import type { DynamicDB } from '../query-builder';
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
    markDone: async () => ok(undefined),
    markFailed: async () => ok(undefined),
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

  it('sets default row order when inserting into schema-qualified table', async () => {
    const { table, schemaName, tableName, viewOrderColumn, primaryFieldId } =
      await createTableWithStorage(db, 'insert-default-order');
    createdSchemas.push(schemaName);

    const repository = createRepository(db as unknown as Kysely<DynamicDB>, table);
    const actorId = ActorId.create('tester')._unsafeUnwrap();
    const context = { actorId };

    const recordA = table.createRecord(new Map([[primaryFieldId, 'A']]))._unsafeUnwrap().record;
    const firstInsertResult = await repository.insert(context, table, recordA);
    expect(firstInsertResult.isOk()).toBe(true);

    const recordB = table.createRecord(new Map([[primaryFieldId, 'B']]))._unsafeUnwrap().record;
    const secondInsertResult = await repository.insert(context, table, recordB);
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
});
