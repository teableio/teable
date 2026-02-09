/* eslint-disable require-yield */
import { PGlite } from '@electric-sql/pglite';
import {
  ActorId,
  BaseId,
  FieldName,
  RecordId,
  Table,
  TableId,
  TableName,
  ViewName,
} from '@teable/v2-core';
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

import { PostgresRecordOrderCalculator } from './PostgresRecordOrderCalculator';

// =============================================================================
// PGlite Kysely Dialect
// =============================================================================

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

// =============================================================================
// Helpers
// =============================================================================

const sanitizeIdSeed = (seed: string): string => seed.replace(/[^0-9a-z]/gi, '0');
const createId = (prefix: string, seed: string): string =>
  `${prefix}${sanitizeIdSeed(seed).padEnd(16, '0').slice(0, 16)}`;

const createTableWithData = async (
  db: Kysely<V1TeableDatabase>,
  seed: string
): Promise<{
  table: Table;
  schemaName: string;
  tableName: string;
  viewId: string;
  recordIds: RecordId[];
}> => {
  const baseId = BaseId.create(createId('bse', seed))._unsafeUnwrap();
  const tableId = TableId.create(createId('tbl', seed))._unsafeUnwrap();
  const tableName = TableName.create(`Order-${seed}`)._unsafeUnwrap();
  const fieldName = FieldName.create('Name')._unsafeUnwrap();
  const viewName = ViewName.create('Grid')._unsafeUnwrap();

  const builder = Table.builder().withBaseId(baseId).withId(tableId).withName(tableName);
  builder.field().singleLineText().withName(fieldName).done();
  builder.view().grid().withName(viewName).done();
  const table = builder.build()._unsafeUnwrap();

  const schemaName = baseId.toString();
  const tableNameStr = tableId.toString();
  const fullTableName = `${schemaName}.${tableNameStr}`;

  await sql`CREATE SCHEMA ${sql.id(schemaName)}`.execute(db);
  await sql`
    CREATE TABLE ${sql.table(fullTableName)} (
      __id text PRIMARY KEY,
      __auto_number integer NOT NULL
    )
  `.execute(db);

  const recordIds = [
    RecordId.create(createId('rec', `${seed}-a`))._unsafeUnwrap(),
    RecordId.create(createId('rec', `${seed}-b`))._unsafeUnwrap(),
    RecordId.create(createId('rec', `${seed}-c`))._unsafeUnwrap(),
  ];

  for (let i = 0; i < recordIds.length; i++) {
    const recordId = recordIds[i]!.toString();
    await sql`
      INSERT INTO ${sql.table(fullTableName)} (__id, __auto_number)
      VALUES (${recordId}, ${i + 1})
    `.execute(db);
  }

  const viewId = table.views()[0]!.id().toString();
  return { table, schemaName, tableName: tableNameStr, viewId, recordIds };
};

// =============================================================================
// Tests
// =============================================================================

describe('PostgresRecordOrderCalculator (pglite)', () => {
  let pglite: PGlite;
  let db: Kysely<V1TeableDatabase>;
  const createdSchemas: string[] = [];

  beforeAll(async () => {
    pglite = await PGlite.create();
    db = new Kysely<V1TeableDatabase>({
      dialect: new KyselyPGliteDialect(pglite),
    });
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

  it('creates order column and calculates values before anchor', async () => {
    const { table, schemaName, tableName, viewId, recordIds } = await createTableWithData(
      db,
      'before'
    );
    createdSchemas.push(schemaName);

    const calculator = new PostgresRecordOrderCalculator(db);
    const context = { actorId: ActorId.create('tester')._unsafeUnwrap() };
    const result = await calculator.calculateOrders(
      context,
      table,
      table.views()[0]!.id(),
      recordIds[1]!,
      'before',
      2
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0]).toBeGreaterThan(1);
      expect(result.value[1]).toBeLessThan(2);
      expect(result.value[0]).toBeLessThan(result.value[1]);
    }

    const orderColumnName = `__row_${viewId}`;
    const columnCheck = await sql<{ column_name: string }>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ${schemaName}
      AND table_name = ${tableName}
      AND column_name = ${orderColumnName}
    `.execute(db);
    expect(columnCheck.rows.length).toBe(1);

    const fullTableName = `${schemaName}.${tableName}`;
    const orderRows = await sql<{ __id: string; order_value: number }>`
      SELECT __id, ${sql.ref(orderColumnName)} as order_value
      FROM ${sql.table(fullTableName)}
      ORDER BY __auto_number ASC
    `.execute(db);
    expect(orderRows.rows.map((row) => row.order_value)).toEqual([1, 2, 3]);
  });

  it('returns not-found when anchor is missing', async () => {
    const { table, schemaName } = await createTableWithData(db, 'missing-anchor');
    createdSchemas.push(schemaName);

    const calculator = new PostgresRecordOrderCalculator(db);
    const context = { actorId: ActorId.create('tester')._unsafeUnwrap() };
    const missingAnchor = RecordId.create(createId('rec', 'missing'))._unsafeUnwrap();
    const result = await calculator.calculateOrders(
      context,
      table,
      table.views()[0]!.id(),
      missingAnchor,
      'after',
      1
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('record.not_found');
      expect(result.error.tags).toContain('not-found');
    }
  });
});
