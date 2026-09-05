/* eslint-disable require-yield */
import { PGlite } from '@electric-sql/pglite';
import {
  ActorId,
  BaseId,
  CellValueMultiplicity,
  CellValueType,
  DbFieldName,
  DateFormattingPreset,
  DateTimeFormatting,
  DbFieldType,
  FieldHasError,
  FieldId,
  FieldName,
  FormulaExpression,
  LookupOptions,
  OffsetPagination,
  NoopTracer,
  PageLimit,
  PageOffset,
  RecordSearch,
  RecordByIdsSpec,
  RecordId,
  SelectOption,
  Table,
  TableId,
  TableName,
  TimeFormatting,
  UserMultiplicity,
  createUserField,
  type ILogger,
  type IRecordSearchAccessPath,
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
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TableRecordQueryBuilderManager } from '../query-builder';
import { PostgresCollaboratorDirectoryService } from './PostgresCollaboratorDirectoryService';
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
  status?: string | null;
  staleComputed?: string | null;
  date?: string | null;
};

const setupRepositoryFixture = async ({
  db,
  createdSchemas,
  seed,
  rows,
  statusOptions,
  includeErroredFormula,
  dateFieldTimeZone,
}: {
  db: Kysely<V1TeableDatabase>;
  createdSchemas: string[];
  seed: string;
  rows: ReadonlyArray<SeededRow>;
  statusOptions?: ReadonlyArray<string>;
  includeErroredFormula?: boolean;
  dateFieldTimeZone?: string;
}) => {
  const baseId = BaseId.create(createId('bse', seed))._unsafeUnwrap();
  const tableId = TableId.create(createId('tbl', seed))._unsafeUnwrap();
  const nameFieldId = FieldId.create(createId('fld', `n-${seed}`))._unsafeUnwrap();
  const ageFieldId = FieldId.create(createId('fld', `a-${seed}`))._unsafeUnwrap();
  const statusFieldId = FieldId.create(createId('fld', `s-${seed}`))._unsafeUnwrap();
  const formulaFieldId = FieldId.create(createId('fld', `f-${seed}`))._unsafeUnwrap();
  const dateFieldId = FieldId.create(createId('fld', `d-${seed}`))._unsafeUnwrap();

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
  if (statusOptions?.length) {
    builder
      .field()
      .singleSelect()
      .withId(statusFieldId)
      .withName(FieldName.create('Status')._unsafeUnwrap())
      .withOptions(
        statusOptions.map((name) => SelectOption.create({ name, color: 'blue' })._unsafeUnwrap())
      )
      .done();
  }
  if (dateFieldTimeZone) {
    builder
      .field()
      .date()
      .withId(dateFieldId)
      .withName(FieldName.create('Due')._unsafeUnwrap())
      .withFormatting(
        DateTimeFormatting.create({
          date: 'YYYY-MM-DD',
          time: TimeFormatting.None,
          timeZone: dateFieldTimeZone,
        })._unsafeUnwrap()
      )
      .done();
  }
  if (includeErroredFormula) {
    builder
      .field()
      .formula()
      .withId(formulaFieldId)
      .withName(FieldName.create('Broken formula')._unsafeUnwrap())
      .withExpression(FormulaExpression.create(`{${nameFieldId.toString()}}`)._unsafeUnwrap())
      .withResultType({
        cellValueType: CellValueType.string(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      })
      .done();
  }
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
  if (statusOptions?.length) {
    table
      .getField((field) => field.id().equals(statusFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_status')._unsafeUnwrap())
      ._unsafeUnwrap();
  }
  if (dateFieldTimeZone) {
    table
      .getField((field) => field.id().equals(dateFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_date')._unsafeUnwrap())
      ._unsafeUnwrap();
  }
  if (includeErroredFormula) {
    const formulaField = table
      .getField((field) => field.id().equals(formulaFieldId))
      ._unsafeUnwrap();
    formulaField
      .setDbFieldName(DbFieldName.rehydrate('col_broken_formula')._unsafeUnwrap())
      ._unsafeUnwrap();
    formulaField.setDbFieldType(DbFieldType.rehydrate('TEXT')._unsafeUnwrap())._unsafeUnwrap();
    formulaField.setHasError(FieldHasError.error());
  }

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
      col_age integer,
      col_status text,
      col_broken_formula text,
      col_date timestamptz
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
        col_age,
        col_status,
        col_broken_formula,
        col_date
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
        ${row.age},
        ${row.status ?? null},
        ${row.staleComputed ?? null},
        ${row.date ?? null}
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
    statusFieldId,
    formulaFieldId,
    dateFieldId,
    insertedRecordIds,
    fullTableName,
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
        "sql": "select "t"."__id" as "__id", "t"."__version" as "__version", "t"."__auto_number" as "__auto_number", "t"."__created_time" as "__created_time", "t"."__created_by" as "__created_by", "t"."__last_modified_time" as "__last_modified_time", "t"."__last_modified_by" as "__last_modified_by", "t"."col_name" as "col_name" from "bseprojection000000"."tblprojection000000" as "t" order by "t"."__auto_number" asc",
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

  it('counts matching rows with count(*) and does not select record columns', async () => {
    const fixture = await setupRepositoryFixture({
      db,
      createdSchemas,
      seed: 'count-only',
      rows: [
        { name: 'Alice', age: 10 },
        { name: 'Bob', age: 20 },
        { name: 'Cara', age: 30 },
      ],
    });

    driver.queries.length = 0;
    driver.rowSnapshots.length = 0;

    const result = await fixture.repository.count(fixture.context, fixture.table, undefined, {
      mode: 'stored',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toBe(3);
    expect(driver.queries).toHaveLength(1);
    expect(driver.queries[0].sql).toContain('count(*)');
    expect(driver.queries[0].sql).not.toContain('col_name');
    expect(driver.queries[0].sql).not.toContain('__auto_number');
  });

  it('orders by auto_number once when the view row column is missing', async () => {
    const baseId = BaseId.create(createId('bse', 'row-order-fallback'))._unsafeUnwrap();
    const tableId = TableId.create(createId('tbl', 'row-order-fallback'))._unsafeUnwrap();
    const nameFieldId = FieldId.create(createId('fld', 'row-name'))._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseId)
      .withId(tableId)
      .withName(TableName.create('Row order fallback')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(nameFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    table
      .getField((field) => field.id().equals(nameFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
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
        col_name text
      )
    `.execute(db);
    await sql`
      INSERT INTO ${sql.table(fullTableName)} (
        __id, __version, __auto_number, __created_time, __created_by,
        __last_modified_time, __last_modified_by, col_name
      )
      VALUES (
        ${createId('rec', 'row-order-fallback')},
        1,
        1,
        ${'2025-01-01T00:00:00.000Z'},
        ${'usr_creator'},
        ${'2025-01-02T00:00:00.000Z'},
        ${'usr_modifier'},
        ${'Alice'}
      )
    `.execute(db);

    const manager = new TableRecordQueryBuilderManager(
      db,
      {} as unknown as ITableRepository,
      new Pg16TypeValidationStrategy()
    );
    const repository = new PostgresTableRecordQueryRepository(manager, db, createLogger());
    const context = { actorId: ActorId.create('tester')._unsafeUnwrap() };
    const viewId = table.views()[0]!.id().toString();

    driver.queries.length = 0;

    const result = await repository.find(context, table, undefined, {
      mode: 'stored',
      includeTotal: false,
      projectionFieldIds: [nameFieldId],
      orderBy: [
        { column: `__row_${viewId}`, direction: 'asc' },
        { column: '__auto_number', direction: 'asc' },
      ],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const selectQuery = driver.queries.find(
      (query) => query.sql.includes('from "') && query.sql.includes('order by')
    );
    expect(selectQuery).toBeDefined();
    expect(selectQuery?.sql).toContain('order by "t"."__auto_number" asc');
    expect(selectQuery?.sql).not.toContain('"t"."__auto_number" is null');
    expect(selectQuery?.sql.match(/"t"."__auto_number" asc/g)).toEqual(['"t"."__auto_number" asc']);
  });

  it('extracts distinct IDs from single and multiple User Fields within the Record scope', async () => {
    const seed = 'collaborators';
    const baseId = BaseId.create(createId('bse', seed))._unsafeUnwrap();
    const tableId = TableId.create(createId('tbl', seed))._unsafeUnwrap();
    const nameFieldId = FieldId.create(createId('fld', 'collab-name'))._unsafeUnwrap();
    const ownerFieldId = FieldId.create(createId('fld', 'collab-owner'))._unsafeUnwrap();
    const teamFieldId = FieldId.create(createId('fld', 'collab-team'))._unsafeUnwrap();
    const builder = Table.builder()
      .withBaseId(baseId)
      .withId(tableId)
      .withName(TableName.create('Collaborator records')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(nameFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .user()
      .withId(ownerFieldId)
      .withName(FieldName.create('Owner')._unsafeUnwrap())
      .done();
    builder
      .field()
      .user()
      .withId(teamFieldId)
      .withName(FieldName.create('Team')._unsafeUnwrap())
      .withMultiplicity(UserMultiplicity.multiple())
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();
    for (const [fieldId, dbFieldName] of [
      [nameFieldId, 'col_name'],
      [ownerFieldId, 'col_owner'],
      [teamFieldId, 'col_team'],
    ] as const) {
      table
        .getField((field) => field.id().equals(fieldId))
        ._unsafeUnwrap()
        .setDbFieldName(DbFieldName.rehydrate(dbFieldName)._unsafeUnwrap())
        ._unsafeUnwrap();
    }

    const schemaName = baseId.toString();
    const fullTableName = `${schemaName}.${tableId.toString()}`;
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
        col_owner jsonb,
        col_team jsonb
      )
    `.execute(db);
    const firstRecordId = createId('rec', 'collab-first');
    const secondRecordId = createId('rec', 'collab-second');
    await sql`
      INSERT INTO ${sql.table(fullTableName)} (
        __id, __version, col_name, col_owner, col_team
      ) VALUES
        (
          ${firstRecordId}, 1, 'First',
          ${JSON.stringify({ id: 'usr1', title: 'Alice' })}::jsonb,
          ${JSON.stringify([
            { id: 'usr1', title: 'Alice' },
            { id: 'usr2', title: 'Bob' },
          ])}::jsonb
        ),
        (
          ${secondRecordId}, 1, 'Second',
          ${JSON.stringify({ id: 'usr1', title: 'Alice' })}::jsonb,
          ${JSON.stringify([
            { id: 'usr2', title: 'Bob' },
            { id: 'usr3', title: 'Carol' },
          ])}::jsonb
        )
    `.execute(db);
    const manager = new TableRecordQueryBuilderManager(
      db,
      {} as unknown as ITableRepository,
      new Pg16TypeValidationStrategy()
    );
    const repository = new PostgresTableRecordQueryRepository(manager, db, createLogger());
    const context = { actorId: ActorId.create('tester')._unsafeUnwrap() };
    const ownerField = table
      .getField((field) => field.id().equals(ownerFieldId))
      ._unsafeUnwrap() as Parameters<typeof repository.findDistinctUserIds>[2];
    const teamField = table
      .getField((field) => field.id().equals(teamFieldId))
      ._unsafeUnwrap() as Parameters<typeof repository.findDistinctUserIds>[2];
    const firstRecordSpec = RecordByIdsSpec.create([
      RecordId.create(firstRecordId)._unsafeUnwrap(),
    ]);

    expect(
      [...(await repository.findDistinctUserIds(context, table, ownerField))._unsafeUnwrap()].sort()
    ).toEqual(['usr1']);
    expect(
      [
        ...(
          await repository.findDistinctUserIds(context, table, teamField, firstRecordSpec)
        )._unsafeUnwrap(),
      ].sort()
    ).toEqual(['usr1', 'usr2']);
    expect(driver.queries.at(-1)?.sql).toContain('jsonb_array_elements');
  });

  it('lists Base/Space collaborators by name only and excludes system users', async () => {
    await sql`
      CREATE TABLE users (
        id text PRIMARY KEY,
        name text NOT NULL,
        email text,
        avatar text,
        is_system boolean
      )
    `.execute(db);
    await sql`
      CREATE TABLE "base" (
        id text PRIMARY KEY,
        space_id text NOT NULL
      )
    `.execute(db);
    await sql`
      CREATE TABLE collaborator (
        id text PRIMARY KEY,
        resource_type text NOT NULL,
        resource_id text NOT NULL,
        principal_id text NOT NULL,
        principal_type text NOT NULL,
        created_time timestamptz NOT NULL
      )
    `.execute(db);
    const baseId = BaseId.create(createId('bse', 'directory'))._unsafeUnwrap();
    const spaceId = createId('spc', 'directory');
    await sql`
      INSERT INTO "base" (id, space_id) VALUES (${baseId.toString()}, ${spaceId})
    `.execute(db);
    await sql`
      INSERT INTO users (id, name, email, avatar, is_system) VALUES
        ('usr-alice', 'Alice', 'private-alice@example.com', 'alice.png', false),
        ('usr-bob', 'Bob', 'private-bob@example.com', NULL, NULL),
        ('usr-system', 'System', 'system@example.com', NULL, true)
    `.execute(db);
    await sql`
      INSERT INTO collaborator (
        id, resource_type, resource_id, principal_id, principal_type, created_time
      ) VALUES
        ('clb-alice', 'base', ${baseId.toString()}, 'usr-alice', 'user', '2025-01-03'),
        ('clb-bob', 'space', ${spaceId}, 'usr-bob', 'user', '2025-01-02'),
        ('clb-system', 'space', ${spaceId}, 'usr-system', 'user', '2025-01-01')
    `.execute(db);
    const service = new PostgresCollaboratorDirectoryService(db);
    const context = { actorId: ActorId.create('tester')._unsafeUnwrap() };
    const firstPage = OffsetPagination.create(
      PageLimit.create(1)._unsafeUnwrap(),
      PageOffset.zero()
    );
    const defaultPage = OffsetPagination.create(
      PageLimit.create(50)._unsafeUnwrap(),
      PageOffset.zero()
    );

    expect(
      (await service.listBaseUsers(context, baseId, { pagination: firstPage }))._unsafeUnwrap()
    ).toEqual([{ id: 'usr-alice', name: 'Alice', avatar: 'alice.png' }]);
    expect(
      (
        await service.listBaseUsers(context, baseId, {
          pagination: defaultPage,
          search: 'private-alice@example.com',
        })
      )._unsafeUnwrap()
    ).toEqual([]);
    expect(
      (
        await service.listUsersByIds(context, ['usr-alice', 'usr-bob', 'usr-alice'], {
          pagination: defaultPage,
          search: 'Bob',
        })
      )._unsafeUnwrap()
    ).toEqual([{ id: 'usr-bob', name: 'Bob', avatar: null }]);
  });

  it('keeps an empty projection as id-only instead of falling back to all fields', async () => {
    const fixture = await setupRepositoryFixture({
      db,
      createdSchemas,
      seed: 'empty-projection',
      rows: [{ name: 'A', age: 10 }],
    });

    driver.queries.length = 0;
    driver.rowSnapshots.length = 0;

    const result = await fixture.repository.find(fixture.context, fixture.table, undefined, {
      mode: 'stored',
      includeTotal: false,
      projectionFieldIds: [],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(driver.queries).toHaveLength(1);
    expect(driver.queries[0].sql).not.toContain('"col_name"');
    expect(driver.queries[0].sql).not.toContain('"col_age"');
    expect(result.value.records[0]?.fields).toEqual({});
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
    expect(driver.queries[0].sql).toContain('order by array_position($');
    expect(driver.queries[0].sql).not.toContain('order by "t"."__auto_number"');
    expect(driver.queries[0].parameters).toEqual([
      ...orderedIds.map((recordId) => recordId.toString()),
      orderedIds.map((recordId) => recordId.toString()),
    ]);
  });

  it('aggregates ordered group counts inside the filtered record scope', async () => {
    const fixture = await setupRepositoryFixture({
      db,
      createdSchemas,
      seed: 'group-counts',
      rows: [
        { name: 'A', age: 10 },
        { name: 'B', age: 20 },
        { name: 'C', age: 20 },
        { name: 'D', age: 30 },
      ],
    });
    const allowedIds = fixture.insertedRecordIds.slice(1);
    driver.queries.length = 0;
    driver.rowSnapshots.length = 0;

    const result = await fixture.repository.find(
      fixture.context,
      fixture.table,
      RecordByIdsSpec.create(allowedIds.map((id) => RecordId.create(id)._unsafeUnwrap())),
      {
        mode: 'stored',
        includeTotal: true,
        groupBy: [{ fieldId: fixture.ageFieldId, direction: 'desc' }],
        groupLimit: 1,
      }
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.total).toBe(3);
    expect(result.value.groups).toEqual([
      { fields: { [fixture.ageFieldId.toString()]: 30 }, count: 1 },
    ]);
    expect(driver.queries).toHaveLength(2);
    const groupQuery = driver.queries.find((query) => query.sql.includes('group by'));
    expect(groupQuery?.sql).toContain('sum(count(*)) over ()');
  });

  it('groups parameterized masked values through the outer group alias (T6997)', async () => {
    const fixture = await setupRepositoryFixture({
      db,
      createdSchemas,
      seed: 'masked-group-counts',
      rows: [
        { name: 'A', age: 10 },
        { name: 'B', age: 20 },
        { name: 'C', age: 20 },
        { name: 'D', age: 30 },
      ],
    });
    const visibleIds = fixture.insertedRecordIds
      .slice(0, 2)
      .map((id) => RecordId.create(id)._unsafeUnwrap());

    const result = await fixture.repository.find(fixture.context, fixture.table, undefined, {
      mode: 'stored',
      includeTotal: true,
      groupBy: [{ fieldId: fixture.ageFieldId, direction: 'asc' }],
      groupLimit: 10,
      fieldMasks: [
        {
          fieldId: fixture.ageFieldId.toString(),
          visibleWhen: RecordByIdsSpec.create(visibleIds),
        },
      ],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.total).toBe(4);
    expect(result.value.groups).toHaveLength(3);
    expect(result.value.groups).toEqual(
      expect.arrayContaining([
        { fields: { [fixture.ageFieldId.toString()]: null }, count: 2 },
        { fields: { [fixture.ageFieldId.toString()]: 10 }, count: 1 },
        { fields: { [fixture.ageFieldId.toString()]: 20 }, count: 1 },
      ])
    );
  });

  it('groups errored computed fields as null instead of stale stored values', async () => {
    const fixture = await setupRepositoryFixture({
      db,
      createdSchemas,
      seed: 'errored-group',
      includeErroredFormula: true,
      rows: [
        { name: 'A', age: 10, staleComputed: 'stale-a' },
        { name: 'B', age: 20, staleComputed: 'stale-b' },
      ],
    });

    const result = await fixture.repository.find(fixture.context, fixture.table, undefined, {
      mode: 'stored',
      includeTotal: false,
      groupBy: [{ fieldId: fixture.formulaFieldId, direction: 'asc' }],
      groupLimit: 5_000,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.groups).toEqual([
      { fields: { [fixture.formulaFieldId.toString()]: null }, count: 2 },
    ]);
    const groupQuery = driver.queries.find((query) => query.sql.includes('group by'));
    expect(groupQuery?.sql).toContain('NULL::text');
    expect(groupQuery?.sql).not.toContain('"t"."col_broken_formula"');
  });

  it('orders single-select groups by configured option order with v1 null semantics', async () => {
    const fixture = await setupRepositoryFixture({
      db,
      createdSchemas,
      seed: 'group-select-order',
      statusOptions: ['Done', 'Blocked', 'Open'],
      rows: [
        { name: 'A', age: 10, status: 'Open' },
        { name: 'B', age: 20, status: null },
        { name: 'C', age: 30, status: 'Done' },
        { name: 'D', age: 40, status: 'Blocked' },
      ],
    });

    const result = await fixture.repository.find(fixture.context, fixture.table, undefined, {
      mode: 'stored',
      includeTotal: false,
      groupBy: [{ fieldId: fixture.statusFieldId, direction: 'asc' }],
      groupLimit: 5_000,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.total).toBe(4);
    expect(
      result.value.groups?.map((group) => group.fields[fixture.statusFieldId.toString()])
    ).toEqual([null, 'Done', 'Blocked', 'Open']);
  });

  it('buckets date groups at the field formatting granularity in its time zone', async () => {
    const fixture = await setupRepositoryFixture({
      db,
      createdSchemas,
      seed: 'group-date-bucket',
      dateFieldTimeZone: 'Asia/Shanghai',
      rows: [
        // 2026-06-02 02:00 and 10:00 local (+08): same local day, one bucket.
        { name: 'A', age: 10, date: '2026-06-01T18:00:00.000Z' },
        { name: 'B', age: 20, date: '2026-06-02T02:00:00.000Z' },
        // 2026-06-03 04:00 local: next day.
        { name: 'C', age: 30, date: '2026-06-02T20:00:00.000Z' },
        { name: 'D', age: 40, date: null },
      ],
    });

    const result = await fixture.repository.find(fixture.context, fixture.table, undefined, {
      mode: 'stored',
      includeTotal: false,
      groupBy: [{ fieldId: fixture.dateFieldId, direction: 'asc' }],
      groupLimit: 5_000,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const groups = result.value.groups?.map((group) => {
      const value = group.fields[fixture.dateFieldId.toString()];
      return {
        value: value == null ? null : new Date(value as string).toISOString(),
        count: group.count,
      };
    });
    // Day buckets keyed as timestamptz of local midnight (V1 parity).
    expect(groups).toEqual([
      { value: null, count: 1 },
      { value: '2026-06-01T16:00:00.000Z', count: 2 },
      { value: '2026-06-02T16:00:00.000Z', count: 1 },
    ]);
    const groupQuery = driver.queries.find((query) => query.sql.includes('group by'));
    expect(groupQuery?.sql).toContain('date_trunc');
  });

  it('merges user group buckets across stored collaborator snapshot variants', async () => {
    const seed = 'group-user-snapshot';
    const baseId = BaseId.create(createId('bse', seed))._unsafeUnwrap();
    const tableId = TableId.create(createId('tbl', seed))._unsafeUnwrap();
    const nameFieldId = FieldId.create(createId('fld', `n-${seed}`))._unsafeUnwrap();
    const ownerFieldId = FieldId.create(createId('fld', `o-${seed}`))._unsafeUnwrap();
    const teamFieldId = FieldId.create(createId('fld', `t-${seed}`))._unsafeUnwrap();
    const builder = Table.builder()
      .withBaseId(baseId)
      .withId(tableId)
      .withName(TableName.create('User group snapshots')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(nameFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .user()
      .withId(ownerFieldId)
      .withName(FieldName.create('Owner')._unsafeUnwrap())
      .done();
    builder
      .field()
      .user()
      .withId(teamFieldId)
      .withName(FieldName.create('Team')._unsafeUnwrap())
      .withMultiplicity(UserMultiplicity.multiple())
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();
    for (const [fieldId, dbFieldName] of [
      [nameFieldId, 'col_name'],
      [ownerFieldId, 'col_owner'],
      [teamFieldId, 'col_team'],
    ] as const) {
      table
        .getField((field) => field.id().equals(fieldId))
        ._unsafeUnwrap()
        .setDbFieldName(DbFieldName.rehydrate(dbFieldName)._unsafeUnwrap())
        ._unsafeUnwrap();
    }

    const schemaName = baseId.toString();
    const fullTableName = `${schemaName}.${tableId.toString()}`;
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
        col_owner jsonb,
        col_team jsonb
      )
    `.execute(db);
    // The same collaborator persisted with different write-time snapshots
    // (email/avatar drift) must land in one group bucket, not one per variant.
    const rows = [
      {
        name: 'A',
        owner: { id: 'usr1', title: 'Alice', email: 'alice@old.example' },
        team: [
          { id: 'usr1', title: 'Alice', email: 'alice@old.example' },
          { id: 'usr2', title: 'Bob' },
        ],
      },
      {
        name: 'B',
        owner: { id: 'usr1', title: 'Alice', email: 'alice@new.example', avatarUrl: 'https://x' },
        team: [
          { id: 'usr1', title: 'Alice', avatarUrl: 'https://x' },
          { id: 'usr2', title: 'Bob', email: 'bob@x.example' },
        ],
      },
      { name: 'C', owner: { id: 'usr2', title: 'Bob' }, team: null },
      { name: 'D', owner: null, team: null },
      // legacy scalar shape: a bare user id stored as the whole cell
      { name: 'E', owner: 'usr3', team: ['usr1', 'usr2'] },
      // non-array multi cells left behind by a single->multiple conversion
      { name: 'F', owner: null, team: { id: 'usr9', title: 'Zoe' } },
      { name: 'G', owner: null, team: 'usr7' },
      // two distinct collaborators sharing a display name, interleaved by
      // insertion order: the identity tiebreak must cluster each user's rows
      { name: 'H', owner: { id: 'usr4', title: 'Sam' }, team: null },
      { name: 'I', owner: { id: 'usr5', title: 'Sam' }, team: null },
      { name: 'J', owner: { id: 'usr4', title: 'Sam' }, team: null },
    ];
    const recordIds: string[] = [];
    for (const [index, row] of rows.entries()) {
      const recordId = createId('rec', `${index}-${seed}`);
      recordIds.push(recordId);
      await sql`
        INSERT INTO ${sql.table(fullTableName)} (__id, __version, __auto_number, col_name, col_owner, col_team)
        VALUES (
          ${recordId},
          1,
          ${index + 1},
          ${row.name},
          ${row.owner == null ? null : JSON.stringify(row.owner)}::jsonb,
          ${row.team == null ? null : JSON.stringify(row.team)}::jsonb
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

    const singleResult = await repository.find(context, table, undefined, {
      mode: 'stored',
      includeTotal: false,
      // mirrors resolveGroupByToOrderBy: group-derived sort entries carry the
      // group-identity collation mark
      orderBy: [
        { fieldId: ownerFieldId, direction: 'asc', groupIdentityCollation: true },
        { column: '__auto_number', direction: 'asc' },
      ],
      groupBy: [{ fieldId: ownerFieldId, direction: 'asc' }],
      groupLimit: 5_000,
    });
    expect(singleResult.isOk()).toBe(true);
    if (singleResult.isErr()) return;
    // records must collate exactly like the group buckets below, or the
    // positional row blocks would land on the wrong rows; same-titled
    // collaborators cluster by the identity tiebreak instead of interleaving
    expect(singleResult.value.records.map((record) => record.id)).toEqual([
      recordIds[3], // null owner
      recordIds[5],
      recordIds[6],
      recordIds[0], // Alice
      recordIds[1],
      recordIds[2], // Bob
      recordIds[7], // Sam usr4
      recordIds[9],
      recordIds[8], // Sam usr5
      recordIds[4], // scalar usr3
    ]);
    expect(singleResult.value.groups).toEqual([
      { fields: { [ownerFieldId.toString()]: null }, count: 3 },
      { fields: { [ownerFieldId.toString()]: { id: 'usr1', title: 'Alice' } }, count: 2 },
      { fields: { [ownerFieldId.toString()]: { id: 'usr2', title: 'Bob' } }, count: 1 },
      { fields: { [ownerFieldId.toString()]: { id: 'usr4', title: 'Sam' } }, count: 2 },
      { fields: { [ownerFieldId.toString()]: { id: 'usr5', title: 'Sam' } }, count: 1 },
      { fields: { [ownerFieldId.toString()]: { id: 'usr3', title: 'usr3' } }, count: 1 },
    ]);

    // range-resolving reads (paste/clear/delete-by-range) pass only the
    // merged orderBy without groupBy metadata — their group-derived entries
    // carry the same collation mark, so the order must be identical or
    // offset-based writes hit the wrong records
    const ungroupedResult = await repository.find(context, table, undefined, {
      mode: 'stored',
      includeTotal: false,
      orderBy: [
        { fieldId: ownerFieldId, direction: 'asc', groupIdentityCollation: true },
        { column: '__auto_number', direction: 'asc' },
      ],
    });
    expect(ungroupedResult.isOk()).toBe(true);
    if (ungroupedResult.isErr()) return;
    expect(ungroupedResult.value.records.map((record) => record.id)).toEqual(
      singleResult.value.records.map((record) => record.id)
    );

    // a plain sort (no group mark) keeps the V1 collation: scalar cells sort
    // in the null-title zone and same-title ties follow insertion order
    const plainSortResult = await repository.find(context, table, undefined, {
      mode: 'stored',
      includeTotal: false,
      orderBy: [
        { fieldId: ownerFieldId, direction: 'asc' },
        { column: '__auto_number', direction: 'asc' },
      ],
    });
    expect(plainSortResult.isOk()).toBe(true);
    if (plainSortResult.isErr()) return;
    expect(plainSortResult.value.records.map((record) => record.id)).toEqual([
      recordIds[3], // null-title zone: empty cells and the legacy scalar
      recordIds[4],
      recordIds[5],
      recordIds[6],
      recordIds[0], // Alice
      recordIds[1],
      recordIds[2], // Bob
      recordIds[7], // Sam ties interleave by insertion order
      recordIds[8],
      recordIds[9],
    ]);

    const multipleResult = await repository.find(context, table, undefined, {
      mode: 'stored',
      includeTotal: false,
      orderBy: [
        { fieldId: teamFieldId, direction: 'asc', groupIdentityCollation: true },
        { column: '__auto_number', direction: 'asc' },
      ],
      groupBy: [{ fieldId: teamFieldId, direction: 'asc' }],
      groupLimit: 5_000,
    });
    expect(multipleResult.isOk()).toBe(true);
    if (multipleResult.isErr()) return;
    expect(multipleResult.value.records.map((record) => record.id)).toEqual([
      recordIds[0], // [Alice, Bob]
      recordIds[1],
      recordIds[5], // object cell {Zoe}
      recordIds[4], // scalar elements [usr1, usr2]
      recordIds[6], // scalar cell usr7
      recordIds[2], // null
      recordIds[3],
      recordIds[7],
      recordIds[8],
      recordIds[9],
    ]);
    // NULL multi-user cells order via the title expression's '[]' fallback
    // (after titled buckets), matching the raw column's stored order semantics.
    expect(multipleResult.value.groups).toEqual([
      {
        fields: {
          [teamFieldId.toString()]: [
            { id: 'usr1', title: 'Alice' },
            { id: 'usr2', title: 'Bob' },
          ],
        },
        count: 2,
      },
      { fields: { [teamFieldId.toString()]: [{ id: 'usr9', title: 'Zoe' }] }, count: 1 },
      {
        fields: {
          [teamFieldId.toString()]: [
            { id: 'usr1', title: 'usr1' },
            { id: 'usr2', title: 'usr2' },
          ],
        },
        count: 1,
      },
      { fields: { [teamFieldId.toString()]: [{ id: 'usr7', title: 'usr7' }] }, count: 1 },
      { fields: { [teamFieldId.toString()]: null }, count: 5 },
    ]);

    // The aggregate path buckets by the same identity, so per-group stats
    // cover the whole collaborator instead of one snapshot generation.
    const aggregation = table
      .createRecordAggregation({
        viewId: table.defaultView()._unsafeUnwrap().id().toString(),
        fields: [{ fieldId: nameFieldId.toString(), statisticFunc: 'count' }],
        groupBy: [{ fieldId: ownerFieldId.toString(), order: 'asc' }],
      })
      ._unsafeUnwrap();
    const aggregateResult = await repository.aggregate(context, table, aggregation);
    expect(aggregateResult.isOk()).toBe(true);
    if (aggregateResult.isErr()) return;
    // aggregate buckets follow the same title+identity collation as the
    // record queries (null title first for asc), so share-view group points
    // line up with their record pages
    expect(aggregateResult.value.map(({ value, groupValues }) => ({ value, groupValues }))).toEqual(
      [
        { value: 10, groupValues: undefined },
        { value: 3, groupValues: [null] },
        { value: 2, groupValues: [expect.objectContaining({ id: 'usr1', title: 'Alice' })] },
        { value: 1, groupValues: [expect.objectContaining({ id: 'usr2', title: 'Bob' })] },
        { value: 2, groupValues: [expect.objectContaining({ id: 'usr4', title: 'Sam' })] },
        { value: 1, groupValues: [expect.objectContaining({ id: 'usr5', title: 'Sam' })] },
        { value: 1, groupValues: [expect.objectContaining({ id: 'usr3', title: 'usr3' })] },
      ]
    );
  });

  it('collates lookup-of-user groups by identity so date sort spans snapshot variants', async () => {
    const seed = 'group-lookup-user-date';
    const baseId = BaseId.create(createId('bse', seed))._unsafeUnwrap();
    const tableId = TableId.create(createId('tbl', seed))._unsafeUnwrap();
    const nameFieldId = FieldId.create(createId('fld', `n-${seed}`))._unsafeUnwrap();
    const ownerLookupFieldId = FieldId.create(createId('fld', `o-${seed}`))._unsafeUnwrap();
    const dateFieldId = FieldId.create(createId('fld', `d-${seed}`))._unsafeUnwrap();
    const innerUserField = createUserField({
      id: FieldId.create(createId('fld', `u-${seed}`))._unsafeUnwrap(),
      name: FieldName.create('Owner')._unsafeUnwrap(),
    })._unsafeUnwrap();
    const builder = Table.builder()
      .withBaseId(baseId)
      .withId(tableId)
      .withName(TableName.create('Lookup user date sort')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(nameFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .lookup()
      .withId(ownerLookupFieldId)
      .withName(FieldName.create('Owner Lookup')._unsafeUnwrap())
      .withInnerField(innerUserField)
      .withLookupOptions(
        LookupOptions.create({
          linkFieldId: createId('fld', `l-${seed}`),
          lookupFieldId: innerUserField.id().toString(),
          foreignTableId: createId('tbl', `f-${seed}`),
        })._unsafeUnwrap()
      )
      .withIsMultipleCellValue(false)
      .done();
    builder
      .field()
      .date()
      .withId(dateFieldId)
      .withName(FieldName.create('Payment Date')._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();
    for (const [fieldId, dbFieldName] of [
      [nameFieldId, 'col_name'],
      [ownerLookupFieldId, 'col_owner_lookup'],
      [dateFieldId, 'col_date'],
    ] as const) {
      table
        .getField((field) => field.id().equals(fieldId))
        ._unsafeUnwrap()
        .setDbFieldName(DbFieldName.rehydrate(dbFieldName)._unsafeUnwrap())
        ._unsafeUnwrap();
    }

    const schemaName = baseId.toString();
    const fullTableName = `${schemaName}.${tableId.toString()}`;
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
        col_owner_lookup jsonb,
        col_date timestamptz
      )
    `.execute(db);

    const ownerId = 'usr1';
    const rows = [
      {
        name: 'd-2025-07',
        owner: { id: ownerId, title: 'Alice', email: 'a@example.com' },
        date: '2025-07-31T00:00:00.000Z',
      },
      {
        name: 'd-2025-04',
        owner: { id: ownerId, title: 'Alice', email: 'a@example.com' },
        date: '2025-04-29T00:00:00.000Z',
      },
      {
        name: 'd-2024-11',
        owner: { id: ownerId, title: 'Alice', email: 'a@example.com' },
        date: '2024-11-14T00:00:00.000Z',
      },
      {
        name: 'd-2026-02',
        owner: { id: ownerId, title: 'Alice', email: 'z@example.com', avatarUrl: 'https://x' },
        date: '2026-02-04T00:00:00.000Z',
      },
      {
        name: 'd-2026-01',
        owner: { id: ownerId, title: 'Alice', email: 'z@example.com', avatarUrl: 'https://x' },
        date: '2026-01-29T00:00:00.000Z',
      },
    ];
    const recordIds: string[] = [];
    for (const [index, row] of rows.entries()) {
      const recordId = createId('rec', `${index}-${seed}`);
      recordIds.push(recordId);
      await sql`
        INSERT INTO ${sql.table(fullTableName)} (
          __id, __version, __auto_number, col_name, col_owner_lookup, col_date
        )
        VALUES (
          ${recordId},
          1,
          ${index + 1},
          ${row.name},
          ${JSON.stringify(row.owner)}::jsonb,
          ${row.date}::timestamptz
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

    const result = await repository.find(context, table, undefined, {
      mode: 'stored',
      includeTotal: false,
      orderBy: [
        { fieldId: ownerLookupFieldId, direction: 'asc', groupIdentityCollation: true },
        { fieldId: dateFieldId, direction: 'desc' },
        { column: '__auto_number', direction: 'asc' },
      ],
      groupBy: [{ fieldId: ownerLookupFieldId, direction: 'asc' }],
      groupLimit: 5_000,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.records.map((record) => record.fields[nameFieldId.toString()])).toEqual([
      'd-2026-02',
      'd-2026-01',
      'd-2025-07',
      'd-2025-04',
      'd-2024-11',
    ]);
    expect(result.value.groups).toEqual([
      {
        fields: {
          [ownerLookupFieldId.toString()]: { id: ownerId, title: 'Alice' },
        },
        count: 5,
      },
    ]);
  });

  it('re-checks view row order column existence after it is created', async () => {
    const fixture = await setupRepositoryFixture({
      db,
      createdSchemas,
      seed: 'row-order',
      rows: [
        { name: 'A', age: 10 },
        { name: 'B', age: 20 },
        { name: 'C', age: 30 },
      ],
    });
    const viewId = fixture.table.views()[0]!.id().toString();
    const orderColumn = `__row_${viewId}` as const;

    const firstResult = await fixture.repository.find(fixture.context, fixture.table, undefined, {
      mode: 'stored',
      includeTotal: false,
      orderBy: [{ column: orderColumn, direction: 'asc' }],
    });
    expect(firstResult.isOk()).toBe(true);
    if (firstResult.isErr()) return;
    expect(firstResult.value.records.map((record) => record.id)).toEqual(fixture.insertedRecordIds);

    await sql`
      ALTER TABLE ${sql.table(`${fixture.table.baseId().toString()}.${fixture.table.id().toString()}`)}
      ADD COLUMN ${sql.id(orderColumn)} double precision
    `.execute(db);
    await sql`
      UPDATE ${sql.table(`${fixture.table.baseId().toString()}.${fixture.table.id().toString()}`)}
      SET ${sql.id(orderColumn)} =
        CASE __auto_number
          WHEN 1 THEN 2
          WHEN 2 THEN 3
          ELSE 1
        END
    `.execute(db);

    const secondResult = await fixture.repository.find(fixture.context, fixture.table, undefined, {
      mode: 'stored',
      includeTotal: false,
      orderBy: [{ column: orderColumn, direction: 'asc' }],
    });
    expect(secondResult.isOk()).toBe(true);
    if (secondResult.isErr()) return;
    expect(secondResult.value.records.map((record) => record.id)).toEqual([
      fixture.insertedRecordIds[2],
      fixture.insertedRecordIds[0],
      fixture.insertedRecordIds[1],
    ]);
  });

  it('projects matched fields with search-result row numbering', async () => {
    const fixture = await setupRepositoryFixture({
      db,
      createdSchemas,
      seed: 'search-match-index',
      rows: [
        { name: 'Alpha', age: 10 },
        { name: 'Beta', age: 20 },
        { name: 'Alpha two', age: 30 },
      ],
    });
    const search = {
      search: RecordSearch.fromTuple(['Alpha', fixture.nameFieldId.toString(), true]),
      visibleFieldIds: [fixture.nameFieldId],
    };
    const pagination = OffsetPagination.create(
      PageLimit.create(1)._unsafeUnwrap(),
      PageOffset.create(1)._unsafeUnwrap()
    );

    const result = await fixture.repository.find(fixture.context, fixture.table, undefined, {
      mode: 'stored',
      includeTotal: false,
      pagination,
      search,
      includeSearchFieldMatches: true,
      searchIndexMode: 'matched',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.searchMatches).toEqual([
      {
        index: 2,
        fieldId: fixture.nameFieldId,
        recordId: RecordId.create(fixture.insertedRecordIds[2]!)._unsafeUnwrap(),
      },
    ]);
    expect(driver.queries.some((query) => query.sql.includes('__search_match_0'))).toBe(true);
    expect(
      driver.queries.some(
        (query) =>
          query.sql.includes('as "__search_match_0"') && query.sql.includes('as "col_name"')
      )
    ).toBe(false);
  });

  it('projects complete filtered/sorted row numbers for search matches', async () => {
    const fixture = await setupRepositoryFixture({
      db,
      createdSchemas,
      seed: 'search-view-index',
      rows: [
        { name: 'Alpha', age: 10 },
        { name: 'Beta', age: 20 },
        { name: 'Alpha two', age: 30 },
      ],
    });
    const search = {
      search: RecordSearch.fromTuple(['Alpha', fixture.nameFieldId.toString(), true]),
      visibleFieldIds: [fixture.nameFieldId],
    };
    const pagination = OffsetPagination.create(
      PageLimit.create(1)._unsafeUnwrap(),
      PageOffset.create(1)._unsafeUnwrap()
    );

    const result = await fixture.repository.find(fixture.context, fixture.table, undefined, {
      mode: 'stored',
      includeTotal: false,
      pagination,
      search,
      includeSearchFieldMatches: true,
      searchIndexMode: 'view',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.searchMatches).toEqual([
      {
        index: 3,
        fieldId: fixture.nameFieldId,
        recordId: RecordId.create(fixture.insertedRecordIds[2]!)._unsafeUnwrap(),
      },
    ]);
    expect(driver.queries.some((query) => query.sql.includes('row_number() over ()'))).toBe(true);
    const viewIndexSql = driver.queries
      .map((query) => query.sql)
      .filter((sql) => sql.includes('row_number() over ()'));
    expect(viewIndexSql.length).toBeGreaterThan(0);
    expect(viewIndexSql.some((sql) => sql.includes('as "col_name"'))).toBe(false);
  });

  it('matches offset pages with cursor under field group and sort order', async () => {
    const fixture = await setupRepositoryFixture({
      db,
      createdSchemas,
      seed: 'cursor-group-sort',
      rows: [
        { name: 'keep-a', age: 2 },
        { name: 'drop-z', age: 9 },
        { name: 'keep-a', age: 8 },
        { name: 'keep-b', age: 1 },
        { name: 'keep-b', age: 7 },
        { name: 'keep-c', age: 3 },
      ],
    });
    const orderBy = [
      { fieldId: fixture.nameFieldId, direction: 'asc' as const },
      { fieldId: fixture.ageFieldId, direction: 'desc' as const },
      { column: '__auto_number' as const, direction: 'asc' as const },
    ];
    const pageSize = OffsetPagination.create(
      PageLimit.create(2)._unsafeUnwrap(),
      PageOffset.zero()
    );
    const offsetPage = await fixture.repository.find(fixture.context, fixture.table, undefined, {
      mode: 'stored',
      includeTotal: false,
      orderBy,
      pagination: OffsetPagination.create(
        PageLimit.create(2)._unsafeUnwrap(),
        PageOffset.create(2)._unsafeUnwrap()
      ),
    });
    const firstPage = await fixture.repository.find(fixture.context, fixture.table, undefined, {
      mode: 'stored',
      includeTotal: false,
      orderBy,
      pagination: pageSize,
    });
    expect(firstPage.isOk()).toBe(true);
    expect(offsetPage.isOk()).toBe(true);
    if (firstPage.isErr() || offsetPage.isErr()) {
      return;
    }
    expect(firstPage.value.nextCursor).toBeTruthy();
    const cursorPage = await fixture.repository.find(fixture.context, fixture.table, undefined, {
      mode: 'stored',
      includeTotal: false,
      orderBy,
      cursor: firstPage.value.nextCursor,
      pagination: pageSize,
    });
    expect(cursorPage.isOk()).toBe(true);

    if (cursorPage.isErr()) {
      return;
    }
    expect(cursorPage.value.records.map((record) => record.id.toString())).toEqual(
      offsetPage.value.records.map((record) => record.id.toString())
    );
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

  it('aggregates totals through the existing Table Record repository', async () => {
    const fixture = await setupRepositoryFixture({
      db,
      createdSchemas,
      seed: 'aggregate-total',
      rows: [
        { name: 'A', age: 10 },
        { name: 'B', age: 20 },
        { name: 'B', age: 20 },
      ],
    });
    const viewId = fixture.table.defaultView()._unsafeUnwrap().id().toString();
    const aggregation = fixture.table
      .createRecordAggregation({
        viewId,
        fields: [
          { fieldId: fixture.nameFieldId.toString(), statisticFunc: 'unique' },
          { fieldId: fixture.ageFieldId.toString(), statisticFunc: 'count' },
          { fieldId: fixture.ageFieldId.toString(), statisticFunc: 'sum' },
          { fieldId: fixture.ageFieldId.toString(), statisticFunc: 'average' },
        ],
      })
      ._unsafeUnwrap();

    const result = await fixture.repository.aggregate(fixture.context, fixture.table, aggregation);

    expect(result.isOk()).toBe(true);
    expect(
      result._unsafeUnwrap().map(({ fieldId, statisticFunc, value, groupValues }) => ({
        fieldId: fieldId.toString(),
        statisticFunc,
        value,
        groupValues,
      }))
    ).toEqual([
      {
        fieldId: fixture.nameFieldId.toString(),
        statisticFunc: 'unique',
        value: 2,
        groupValues: undefined,
      },
      {
        fieldId: fixture.ageFieldId.toString(),
        statisticFunc: 'count',
        value: 3,
        groupValues: undefined,
      },
      {
        fieldId: fixture.ageFieldId.toString(),
        statisticFunc: 'sum',
        value: 50,
        groupValues: undefined,
      },
      {
        fieldId: fixture.ageFieldId.toString(),
        statisticFunc: 'average',
        value: 50 / 3,
        groupValues: undefined,
      },
    ]);
    expect(driver.queries.at(-1)?.sql).toContain('with "record_aggregation_scope" as');
  });

  it('returns every requested group prefix and respects the record condition spec', async () => {
    const fixture = await setupRepositoryFixture({
      db,
      createdSchemas,
      seed: 'aggregate-group',
      rows: [
        { name: 'A', age: 10 },
        { name: 'A', age: 20 },
        { name: 'B', age: 30 },
      ],
    });
    const aggregation = fixture.table
      .createRecordAggregation({
        viewId: fixture.table.defaultView()._unsafeUnwrap().id().toString(),
        fields: [{ fieldId: fixture.ageFieldId.toString(), statisticFunc: 'sum' }],
        groupBy: [
          { fieldId: fixture.nameFieldId.toString(), order: 'asc' },
          { fieldId: fixture.ageFieldId.toString(), order: 'asc' },
        ],
      })
      ._unsafeUnwrap();
    const selectedIds = [
      RecordId.create(fixture.insertedRecordIds[0]!)._unsafeUnwrap(),
      RecordId.create(fixture.insertedRecordIds[1]!)._unsafeUnwrap(),
    ];

    const result = await fixture.repository.aggregate(
      fixture.context,
      fixture.table,
      aggregation,
      RecordByIdsSpec.create(selectedIds)
    );

    expect(result.isOk()).toBe(true);
    expect(
      result._unsafeUnwrap().map(({ statisticFunc, value, groupValues }) => ({
        statisticFunc,
        value,
        groupValues,
      }))
    ).toEqual([
      { statisticFunc: 'sum', value: 30, groupValues: undefined },
      { statisticFunc: 'sum', value: 30, groupValues: ['A'] },
      { statisticFunc: 'sum', value: 10, groupValues: ['A', 10] },
      { statisticFunc: 'sum', value: 20, groupValues: ['A', 20] },
    ]);
  });

  it.each(['default', 'generated_text', 'fallback'] as const)(
    'orders group rows and applies %s search before aggregation',
    async (accessMode) => {
      const fixture = await setupRepositoryFixture({
        db,
        createdSchemas,
        seed: 'aggregate-search',
        rows: [
          { name: 'Alpha', age: 10 },
          { name: 'Alpine', age: 20 },
          { name: 'Beta', age: 30 },
        ],
      });
      const aggregation = fixture.table
        .createRecordAggregation({
          viewId: fixture.table.defaultView()._unsafeUnwrap().id().toString(),
          fields: [{ fieldId: fixture.ageFieldId.toString(), statisticFunc: 'count' }],
          groupBy: [{ fieldId: fixture.nameFieldId.toString(), order: 'desc' }],
        })
        ._unsafeUnwrap();

      if (accessMode === 'generated_text') {
        await sql`
        ALTER TABLE ${sql.table(fixture.fullTableName)}
        ADD COLUMN __tqops_search_document text GENERATED ALWAYS AS (lower(coalesce(col_name, ''))) STORED
      `.execute(db);
      }
      const searchAccessPath: IRecordSearchAccessPath | undefined =
        accessMode === 'default'
          ? undefined
          : {
              kind: 'generated_text',
              generatedColumnName: '__tqops_search_document',
              provider: 'pg_trgm',
              searchScope: 'selected_fields',
              coveredFieldIds: [
                accessMode === 'fallback' ? fixture.ageFieldId : fixture.nameFieldId,
              ],
            };
      const tracer = new NoopTracer();
      const span = {
        setAttribute: vi.fn(),
        setAttributes: vi.fn(),
        recordError: vi.fn(),
        end: vi.fn(),
      };
      vi.spyOn(tracer, 'startSpan').mockReturnValue(span);

      const result = await fixture.repository.aggregate(
        { ...fixture.context, tracer },
        fixture.table,
        aggregation,
        undefined,
        {
          search: {
            search: RecordSearch.fromTuple(['Alp', fixture.nameFieldId.toString(), true]),
            visibleFieldIds: [fixture.nameFieldId],
          },
          searchAccessPath,
        }
      );

      expect(
        result._unsafeUnwrap().map(({ value, groupValues }) => ({ value, groupValues }))
      ).toEqual([
        { value: 2, groupValues: undefined },
        { value: 1, groupValues: ['Alpine'] },
        { value: 1, groupValues: ['Alpha'] },
      ]);
      expect(driver.queries.at(-1)?.sql).toContain('order by "a"."col_name" desc');
      const compiled = driver.queries.at(-1)?.sql.toLowerCase() ?? '';
      expect(compiled.includes('"t"."__tqops_search_document" like')).toBe(
        accessMode === 'generated_text'
      );
      expect(compiled).toContain('ilike');
      expect(span.setAttributes).toHaveBeenCalledWith(
        expect.objectContaining({
          'teable.query.source': 'repository.record_aggregate',
          'teable.search.access_path':
            accessMode === 'generated_text'
              ? 'generated_text_trigram'
              : accessMode === 'fallback'
                ? 'fallback'
                : 'default_ilike',
          ...(accessMode === 'fallback'
            ? { 'teable.search.fallback_reason': 'generated_text_coverage_mismatch' }
            : {}),
        })
      );
    }
  );

  it('aggregates flattened multiple values and attachment sizes without a legacy query adapter', async () => {
    const seed = 'aggregate-json';
    const baseId = BaseId.create(createId('bse', seed))._unsafeUnwrap();
    const tableId = TableId.create(createId('tbl', seed))._unsafeUnwrap();
    const nameFieldId = FieldId.create(createId('fld', `n-${seed}`))._unsafeUnwrap();
    const tagsFieldId = FieldId.create(createId('fld', `t-${seed}`))._unsafeUnwrap();
    const filesFieldId = FieldId.create(createId('fld', `f-${seed}`))._unsafeUnwrap();
    const builder = Table.builder()
      .withBaseId(baseId)
      .withId(tableId)
      .withName(TableName.create('JSON Aggregation')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(nameFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .multipleSelect()
      .withId(tagsFieldId)
      .withName(FieldName.create('Tags')._unsafeUnwrap())
      .done();
    builder
      .field()
      .attachment()
      .withId(filesFieldId)
      .withName(FieldName.create('Files')._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();
    for (const [fieldId, dbFieldName] of [
      [nameFieldId, 'col_name'],
      [tagsFieldId, 'col_tags'],
      [filesFieldId, 'col_files'],
    ] as const) {
      table
        .getField((field) => field.id().equals(fieldId))
        ._unsafeUnwrap()
        .setDbFieldName(DbFieldName.rehydrate(dbFieldName)._unsafeUnwrap())
        ._unsafeUnwrap();
    }

    const schemaName = baseId.toString();
    const fullTableName = `${schemaName}.${tableId.toString()}`;
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
        col_tags jsonb,
        col_files jsonb
      )
    `.execute(db);
    const rows = [
      { name: 'A', tags: ['A', 'B'], files: [{ size: 10 }, { size: 20 }] },
      { name: 'B', tags: ['B'], files: [{ size: 5 }] },
      { name: 'C', tags: null, files: null },
    ];
    for (const [index, row] of rows.entries()) {
      await sql`
        INSERT INTO ${sql.table(fullTableName)} (
          __id, __version, __auto_number, __created_time, __created_by,
          __last_modified_time, __last_modified_by, col_name, col_tags, col_files
        ) VALUES (
          ${createId('rec', `${index}-${seed}`)}, 1, ${index + 1},
          ${'2025-01-01T00:00:00.000Z'}, ${'usr_creator'},
          ${'2025-01-02T00:00:00.000Z'}, ${'usr_modifier'},
          ${row.name}, ${row.tags ? JSON.stringify(row.tags) : null}::jsonb,
          ${row.files ? JSON.stringify(row.files) : null}::jsonb
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
    const aggregation = table
      .createRecordAggregation({
        viewId: table.defaultView()._unsafeUnwrap().id().toString(),
        fields: [
          { fieldId: tagsFieldId.toString(), statisticFunc: 'unique' },
          { fieldId: tagsFieldId.toString(), statisticFunc: 'percentUnique' },
          { fieldId: filesFieldId.toString(), statisticFunc: 'totalAttachmentSize' },
        ],
      })
      ._unsafeUnwrap();

    const result = await repository.aggregate(context, table, aggregation);

    expect(
      result._unsafeUnwrap().map(({ statisticFunc, value }) => ({ statisticFunc, value }))
    ).toEqual([
      { statisticFunc: 'unique', value: 2 },
      { statisticFunc: 'percentUnique', value: 200 / 3 },
      { statisticFunc: 'totalAttachmentSize', value: 35 },
    ]);
  });

  it('collects inclusive calendar days with timezone, null-end fallback, search, and top-ten ids', async () => {
    const seed = 'calendar-daily';
    const baseId = BaseId.create(createId('bse', seed))._unsafeUnwrap();
    const tableId = TableId.create(createId('tbl', seed))._unsafeUnwrap();
    const nameFieldId = FieldId.create(createId('fld', `n-${seed}`))._unsafeUnwrap();
    const startFieldId = FieldId.create(createId('fld', `s-${seed}`))._unsafeUnwrap();
    const endFieldId = FieldId.create(createId('fld', `e-${seed}`))._unsafeUnwrap();
    const formatting = DateTimeFormatting.create({
      date: DateFormattingPreset.ISO,
      time: TimeFormatting.Hour24,
      timeZone: 'Asia/Singapore',
    })._unsafeUnwrap();
    const builder = Table.builder()
      .withBaseId(baseId)
      .withId(tableId)
      .withName(TableName.create('Calendar Daily')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(nameFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .date()
      .withId(startFieldId)
      .withName(FieldName.create('Start')._unsafeUnwrap())
      .withFormatting(formatting)
      .done();
    builder
      .field()
      .date()
      .withId(endFieldId)
      .withName(FieldName.create('End')._unsafeUnwrap())
      .withFormatting(formatting)
      .done();
    builder.view().calendar().defaultName().done();
    const table = builder.build()._unsafeUnwrap();
    for (const [fieldId, dbFieldName] of [
      [nameFieldId, 'col_name'],
      [startFieldId, 'col_start'],
      [endFieldId, 'col_end'],
    ] as const) {
      table
        .getField((field) => field.id().equals(fieldId))
        ._unsafeUnwrap()
        .setDbFieldName(DbFieldName.rehydrate(dbFieldName)._unsafeUnwrap())
        ._unsafeUnwrap();
    }

    const schemaName = baseId.toString();
    const fullTableName = `${schemaName}.${tableId.toString()}`;
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
        col_start timestamptz,
        col_end timestamptz
      )
    `.execute(db);
    const rows = [
      {
        name: 'Alpha span',
        start: '2024-12-31T16:30:00.000Z',
        end: '2025-01-02T16:30:00.000Z',
      },
      { name: 'Alpha null', start: '2025-01-01T17:00:00.000Z', end: null },
      { name: 'Beta excluded', start: '2025-01-01T18:00:00.000Z', end: null },
      ...Array.from({ length: 9 }, (_, index) => ({
        name: `Alpha ${index}`,
        start: new Date(
          Date.parse('2025-01-01T19:00:00.000Z') + index * 60 * 60 * 1000
        ).toISOString(),
        end: null,
      })),
    ];
    for (const [index, row] of rows.entries()) {
      await sql`
        INSERT INTO ${sql.table(fullTableName)} (
          __id, __version, __auto_number, __created_time, __created_by,
          __last_modified_time, __last_modified_by, col_name, col_start, col_end
        ) VALUES (
          ${createId('rec', `${index}-${seed}`)}, 1, ${index + 1},
          ${'2025-01-01T00:00:00.000Z'}, ${'usr_creator'},
          ${'2025-01-02T00:00:00.000Z'}, ${'usr_modifier'},
          ${row.name}, ${row.start}, ${row.end}
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
    const calendar = table
      .createRecordCalendarDailyCollection({
        viewId: table.defaultView()._unsafeUnwrap().id().toString(),
        startFieldId: startFieldId.toString(),
        endFieldId: endFieldId.toString(),
      })
      ._unsafeUnwrap();

    const result = await repository.calendarDailyCollection(
      context,
      table,
      calendar,
      {
        startDate: '2025-01-01T00:00:00+08:00',
        endDate: '2025-01-03T00:00:00+08:00',
      },
      undefined,
      {
        search: {
          search: RecordSearch.fromTuple(['Alpha', nameFieldId.toString(), true]),
          visibleFieldIds: [nameFieldId],
        },
      }
    );

    expect(
      result._unsafeUnwrap().map((entry) => ({
        date: entry.date,
        count: entry.count,
        recordIds: entry.recordIds.length,
      }))
    ).toEqual([
      { date: '2025-01-01', count: 1, recordIds: 1 },
      { date: '2025-01-02', count: 11, recordIds: 10 },
      { date: '2025-01-03', count: 1, recordIds: 1 },
    ]);
    expect(driver.queries.at(-1)?.sql).toContain('generate_series');
    expect(driver.queries.at(-1)?.sql).not.toContain('knex');
  });
});
