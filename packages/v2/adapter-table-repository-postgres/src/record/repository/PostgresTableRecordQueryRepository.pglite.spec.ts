/* eslint-disable require-yield */
import { PGlite } from '@electric-sql/pglite';
import {
  ActorId,
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  RecordByIdsSpec,
  RecordId,
  Table,
  TableId,
  TableName,
  type ILogger,
  type ITableRepository,
} from '@teable/v2-core';
import { Pg16TypeValidationStrategy } from '@teable/v2-formula-sql-pg';
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

import { TableRecordQueryBuilderManager } from '../query-builder';
import { PostgresTableRecordQueryRepository } from './PostgresTableRecordQueryRepository';

class RecordingDriver {
  constructor(private readonly client: PGlite) {}

  readonly queries: CompiledQuery[] = [];
  readonly rowSnapshots: Array<ReadonlyArray<Record<string, unknown>>> = [];

  async acquireConnection() {
    return new RecordingConnection(this.client, this.queries, this.rowSnapshots);
  }

  async beginTransaction(connection: RecordingConnection) {
    await connection.executeQuery(CompiledQuery.raw('BEGIN'));
  }

  async commitTransaction(connection: RecordingConnection) {
    await connection.executeQuery(CompiledQuery.raw('COMMIT'));
  }

  async rollbackTransaction(connection: RecordingConnection) {
    await connection.executeQuery(CompiledQuery.raw('ROLLBACK'));
  }

  async destroy() {
    await this.client.close();
  }

  async init() {}

  async releaseConnection() {}
}

class RecordingConnection {
  constructor(
    private readonly client: PGlite,
    private readonly queries: CompiledQuery[],
    private readonly rowSnapshots: Array<ReadonlyArray<Record<string, unknown>>>
  ) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    this.queries.push(compiledQuery);
    const result = await this.client.query<R>(compiledQuery.sql, [...compiledQuery.parameters]);
    const rows = result.rows as unknown as Record<string, unknown>[];
    this.rowSnapshots.push(rows.map((row) => ({ ...row })));
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
  constructor(private readonly driver: RecordingDriver) {}

  createAdapter() {
    return new PostgresAdapter();
  }

  createDriver() {
    return this.driver;
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

type SeededRow = {
  name: string;
  age: number;
};

const setupRepositoryFixture = async ({
  db,
  createdSchemas,
  seed,
  rows,
}: {
  db: Kysely<V1TeableDatabase>;
  createdSchemas: string[];
  seed: string;
  rows: ReadonlyArray<SeededRow>;
}) => {
  const baseId = BaseId.create(createId('bse', seed))._unsafeUnwrap();
  const tableId = TableId.create(createId('tbl', seed))._unsafeUnwrap();
  const nameFieldId = FieldId.create(createId('fld', `n-${seed}`))._unsafeUnwrap();
  const ageFieldId = FieldId.create(createId('fld', `a-${seed}`))._unsafeUnwrap();

  const builder = Table.builder()
    .withBaseId(baseId)
    .withId(tableId)
    .withName(TableName.create(`${seed} Table`)._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(nameFieldId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .number()
    .withId(ageFieldId)
    .withName(FieldName.create('Age')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  table
    .getField((field) => field.id().equals(nameFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
    ._unsafeUnwrap();
  table
    .getField((field) => field.id().equals(ageFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_age')._unsafeUnwrap())
    ._unsafeUnwrap();

  const schemaName = baseId.toString();
  const tableName = tableId.toString();
  const fullTableName = `${schemaName}.${tableName}`;
  createdSchemas.push(schemaName);

  await sql`CREATE SCHEMA ${sql.id(schemaName)}`.execute(db);
  await sql`
    CREATE TABLE ${sql.table(fullTableName)} (
      __id text PRIMARY KEY,
      __version integer NOT NULL,
      __auto_number integer,
      __created_time timestamptz,
      __created_by text,
      __last_modified_time timestamptz,
      __last_modified_by text,
      col_name text,
      col_age integer
    )
  `.execute(db);

  const insertedRecordIds: string[] = [];
  for (const [index, row] of rows.entries()) {
    const recordId = createId('rec', `${index}-${seed}`);
    insertedRecordIds.push(recordId);
    await sql`
      INSERT INTO ${sql.table(fullTableName)} (
        __id,
        __version,
        __auto_number,
        __created_time,
        __created_by,
        __last_modified_time,
        __last_modified_by,
        col_name,
        col_age
      )
      VALUES (
        ${recordId},
        1,
        ${index + 1},
        ${'2025-01-01T00:00:00.000Z'},
        ${'usr_creator'},
        ${'2025-01-02T00:00:00.000Z'},
        ${'usr_modifier'},
        ${row.name},
        ${row.age}
      )
    `.execute(db);
  }

  const manager = new TableRecordQueryBuilderManager(
    db,
    {} as unknown as ITableRepository,
    new Pg16TypeValidationStrategy()
  );
  const repository = new PostgresTableRecordQueryRepository(manager, db, createLogger());
  const context = { actorId: ActorId.create('tester')._unsafeUnwrap() };

  return {
    repository,
    context,
    table,
    nameFieldId,
    ageFieldId,
    insertedRecordIds,
  };
};

describe('PostgresTableRecordQueryRepository projection (pglite)', () => {
  let db: Kysely<V1TeableDatabase>;
  let driver: RecordingDriver;
  const createdSchemas: string[] = [];

  beforeAll(async () => {
    const pglite = await PGlite.create();
    driver = new RecordingDriver(pglite);
    db = new Kysely<V1TeableDatabase>({
      dialect: new KyselyPGliteDialect(driver),
    });
  });

  afterEach(async () => {
    for (const schemaName of createdSchemas) {
      await sql`DROP SCHEMA IF EXISTS ${sql.id(schemaName)} CASCADE`.execute(db);
    }
    createdSchemas.length = 0;
    driver.queries.length = 0;
    driver.rowSnapshots.length = 0;
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('selects and returns only projected field columns (plus system columns)', async () => {
    const baseId = BaseId.create(createId('bse', 'projection'))._unsafeUnwrap();
    const tableId = TableId.create(createId('tbl', 'projection'))._unsafeUnwrap();
    const nameFieldId = FieldId.create(createId('fld', 'name'))._unsafeUnwrap();
    const ageFieldId = FieldId.create(createId('fld', 'age'))._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseId)
      .withId(tableId)
      .withName(TableName.create('Projection Table')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(nameFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .number()
      .withId(ageFieldId)
      .withName(FieldName.create('Age')._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    table
      .getField((field) => field.id().equals(nameFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
      ._unsafeUnwrap();
    table
      .getField((field) => field.id().equals(ageFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_age')._unsafeUnwrap())
      ._unsafeUnwrap();

    const schemaName = baseId.toString();
    const tableName = tableId.toString();
    const fullTableName = `${schemaName}.${tableName}`;
    createdSchemas.push(schemaName);

    await sql`CREATE SCHEMA ${sql.id(schemaName)}`.execute(db);
    await sql`
      CREATE TABLE ${sql.table(fullTableName)} (
        __id text PRIMARY KEY,
        __version integer NOT NULL,
        __auto_number integer,
        __created_time timestamptz,
        __created_by text,
        __last_modified_time timestamptz,
        __last_modified_by text,
        col_name text,
        col_age integer
      )
    `.execute(db);
    await sql`
      INSERT INTO ${sql.table(fullTableName)} (
        __id,
        __version,
        __auto_number,
        __created_time,
        __created_by,
        __last_modified_time,
        __last_modified_by,
        col_name,
        col_age
      )
      VALUES (
        ${createId('rec', 'projection')},
        1,
        1,
        ${'2025-01-01T00:00:00.000Z'},
        ${'usr_creator'},
        ${'2025-01-02T00:00:00.000Z'},
        ${'usr_modifier'},
        ${'Alice'},
        ${18}
      )
    `.execute(db);

    const manager = new TableRecordQueryBuilderManager(
      db,
      {} as unknown as ITableRepository,
      new Pg16TypeValidationStrategy()
    );
    const repository = new PostgresTableRecordQueryRepository(manager, db, createLogger());
    const context = { actorId: ActorId.create('tester')._unsafeUnwrap() };

    driver.queries.length = 0;
    driver.rowSnapshots.length = 0;

    const result = await repository.find(context, table, undefined, {
      mode: 'stored',
      includeTotal: false,
      projectionFieldIds: [nameFieldId],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(driver.queries).toHaveLength(1);
    expect({
      sql: driver.queries[0].sql,
      parameters: driver.queries[0].parameters,
    }).toMatchInlineSnapshot(`
      {
        "parameters": [],
        "sql": "select "t"."__id" as "__id", "t"."__version" as "__version", "t"."__auto_number" as "__auto_number", "t"."__created_time" as "__created_time", "t"."__created_by" as "__created_by", "t"."__last_modified_time" as "__last_modified_time", "t"."__last_modified_by" as "__last_modified_by", "t"."col_name" as "col_name" from "bseprojection000000"."tblprojection000000" as "t" order by "t"."__auto_number" is null desc, "t"."__auto_number" asc",
      }
    `);
    expect(driver.queries[0].sql).not.toContain('"col_age"');

    const firstRow = driver.rowSnapshots[0]?.[0];
    expect(firstRow).toBeDefined();
    expect(Object.keys(firstRow ?? {}).sort()).toEqual(
      [
        '__id',
        '__version',
        '__auto_number',
        '__created_time',
        '__created_by',
        '__last_modified_time',
        '__last_modified_by',
        'col_name',
      ].sort()
    );
    expect(firstRow).toMatchObject({
      col_name: 'Alice',
    });
    expect(firstRow).not.toHaveProperty('col_age');

    const record = result.value.records[0];
    expect(Object.keys(record.fields)).toEqual([nameFieldId.toString()]);
    expect(record.fields[nameFieldId.toString()]).toBe('Alice');
    expect(record.fields).not.toHaveProperty(ageFieldId.toString());
  });

  it('preserves explicit recordIdsOrder in SQL before pagination', async () => {
    const fixture = await setupRepositoryFixture({
      db,
      createdSchemas,
      seed: 'ordered-ids',
      rows: [
        { name: 'A', age: 10 },
        { name: 'B', age: 20 },
        { name: 'C', age: 30 },
      ],
    });
    const orderedIds = [
      RecordId.create(fixture.insertedRecordIds[2]!)._unsafeUnwrap(),
      RecordId.create(fixture.insertedRecordIds[0]!)._unsafeUnwrap(),
    ];

    driver.queries.length = 0;
    driver.rowSnapshots.length = 0;

    const result = await fixture.repository.find(
      fixture.context,
      fixture.table,
      RecordByIdsSpec.create(orderedIds),
      {
        mode: 'stored',
        includeTotal: false,
        recordIdsOrder: orderedIds,
      }
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.records.map((record) => record.id)).toEqual(
      orderedIds.map((recordId) => recordId.toString())
    );
    expect(driver.queries).toHaveLength(1);
    expect(driver.queries[0].sql).toContain('order by case when "t"."__id" =');
    expect(driver.queries[0].sql).not.toContain('order by "t"."__auto_number"');
  });

  it('streams correct pages for cursor pagination and respects projection', async () => {
    const fixture = await setupRepositoryFixture({
      db,
      createdSchemas,
      seed: 'stream-cursor',
      rows: [
        { name: 'A', age: 10 },
        { name: 'B', age: 20 },
        { name: 'C', age: 30 },
        { name: 'D', age: 40 },
        { name: 'E', age: 50 },
      ],
    });

    driver.queries.length = 0;
    driver.rowSnapshots.length = 0;

    const streamedRecordIds: string[] = [];
    const streamedNames: string[] = [];
    for await (const rowResult of fixture.repository.findStream(
      fixture.context,
      fixture.table,
      undefined,
      {
        mode: 'stored',
        batchSize: 2,
        pagination: {
          cursor: '2',
          limit: 3,
        },
        projectionFieldIds: [fixture.nameFieldId],
      }
    )) {
      expect(rowResult.isOk()).toBe(true);
      if (rowResult.isErr()) {
        continue;
      }
      streamedRecordIds.push(rowResult.value.id);
      streamedNames.push(rowResult.value.fields[fixture.nameFieldId.toString()] as string);
      expect(Object.keys(rowResult.value.fields)).toEqual([fixture.nameFieldId.toString()]);
    }

    expect(streamedRecordIds).toEqual(fixture.insertedRecordIds.slice(2, 5));
    expect(streamedNames).toEqual(['C', 'D', 'E']);

    // Two batched reads:
    // 1) cursor=2 with limit=min(batch=2, remaining=3) => where auto_number > 2 limit 2
    // 2) next cursor from page1 tail is 4 => where auto_number > 4 limit 1
    expect(driver.queries).toHaveLength(2);
    expect(driver.queries.map((q) => q.parameters)).toEqual([
      [2, 2],
      [4, 1],
    ]);
    expect(driver.queries[0].sql).toContain(' limit ');
    expect(driver.queries[0].sql).not.toContain(' offset ');
    expect(driver.queries[0].sql).toContain('"__auto_number" >');
    expect(driver.queries[0].sql).toContain('"col_name"');
    expect(driver.queries[0].sql).not.toContain('"col_age"');
  });

  it('falls back to offset 0 when cursor is invalid', async () => {
    const fixture = await setupRepositoryFixture({
      db,
      createdSchemas,
      seed: 'stream-invalid-cursor',
      rows: [
        { name: 'A', age: 10 },
        { name: 'B', age: 20 },
        { name: 'C', age: 30 },
      ],
    });

    driver.queries.length = 0;
    driver.rowSnapshots.length = 0;

    const streamedRecordIds: string[] = [];
    for await (const rowResult of fixture.repository.findStream(
      fixture.context,
      fixture.table,
      undefined,
      {
        mode: 'stored',
        batchSize: 5,
        pagination: {
          cursor: 'not-a-number',
          limit: 2,
        },
        projectionFieldIds: [fixture.ageFieldId],
      }
    )) {
      expect(rowResult.isOk()).toBe(true);
      if (rowResult.isErr()) {
        continue;
      }
      streamedRecordIds.push(rowResult.value.id);
      expect(Object.keys(rowResult.value.fields)).toEqual([fixture.ageFieldId.toString()]);
    }

    expect(streamedRecordIds).toEqual(fixture.insertedRecordIds.slice(0, 2));
    expect(driver.queries).toHaveLength(1);
    expect(driver.queries[0].parameters).toEqual([2]);
    expect(driver.queries[0].sql).not.toContain(' offset ');
    expect(driver.queries[0].sql).not.toContain('"__auto_number" >');
  });
});
