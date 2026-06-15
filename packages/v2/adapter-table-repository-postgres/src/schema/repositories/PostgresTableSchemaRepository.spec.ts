import { PGlite } from '@electric-sql/pglite';
import { PostgresUnitOfWorkTransaction } from '@teable/v2-adapter-db-postgres-shared';
import {
  ActorId,
  BaseId,
  createLinkField,
  createSingleLineTextField,
  DbTableName,
  FieldId,
  LinkFieldConfig,
  LinkFieldMeta,
  LinkRelationship,
  FieldName,
  type Field,
  type IExecutionContext,
  Table,
  TableId,
  TableName,
  type TableByIdSpec,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import {
  CompiledQuery,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
  type Dialect,
  type QueryResult,
} from 'kysely';
import { ok } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSchemaChecker } from '../rules/checker/SchemaChecker';
import { PostgresSchemaIntrospector } from '../rules/context/PostgresSchemaIntrospector';
import { installUndoCaptureGlobals } from '../visitors/__tests__/helpers/installUndoCaptureGlobals';
import { PostgresTableSchemaRepository } from './PostgresTableSchemaRepository';

class PGliteDriver {
  #client: PGlite;
  readonly queries: CompiledQuery[] = [];

  constructor(client: PGlite) {
    this.#client = client;
  }

  async acquireConnection() {
    return new PGliteConnection(this.#client, this.queries);
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

  async init() {
    await Promise.resolve();
  }

  async releaseConnection(_connection: PGliteConnection) {
    await Promise.resolve();
  }
}

class PGliteConnection {
  #client: PGlite;

  constructor(
    client: PGlite,
    private readonly queries: CompiledQuery[]
  ) {
    this.#client = client;
  }

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    this.queries.push(compiledQuery);
    const result = await this.#client.query<R>(compiledQuery.sql, [...compiledQuery.parameters]);
    return {
      rows: result.rows,
      numAffectedRows: result.affectedRows ? BigInt(result.affectedRows) : undefined,
    };
  }

  streamQuery(): AsyncGenerator<never> {
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        return Promise.reject(new Error('Streaming not supported'));
      },
      async return() {
        return { done: true, value: undefined as never };
      },
      async throw(error) {
        return Promise.reject(error);
      },
      async [Symbol.asyncDispose]() {
        // no-op for test/fake; required for AsyncGenerator type compatibility
      },
    } as AsyncGenerator<never>;
  }
}

class PGliteDialect implements Dialect {
  readonly driver: PGliteDriver;

  constructor(client: PGlite) {
    this.driver = new PGliteDriver(client);
  }

  createDriver() {
    return this.driver;
  }

  createAdapter() {
    return new PostgresAdapter();
  }

  createIntrospector(db: Kysely<unknown>) {
    return new PostgresIntrospector(db);
  }

  createQueryCompiler() {
    return new PostgresQueryCompiler();
  }
}

const createReferenceTable = async (targetDb: Kysely<V1TeableDatabase>) => {
  await targetDb.schema
    .createTable('reference')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('to_field_id', 'text')
    .addColumn('from_field_id', 'text')
    .addUniqueConstraint('reference_to_from_unique', ['to_field_id', 'from_field_id'])
    .execute();
};

const createFieldMetaTable = async (targetDb: Kysely<V1TeableDatabase>) => {
  await targetDb.schema
    .createTable('field')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('meta', 'text')
    .execute();
};

class FakeComputedFieldBackfillService {
  calls: Array<{
    table: Table;
    fields: ReadonlyArray<Field>;
    skipDistinctFilter?: boolean;
    includeOneManyTwoWay?: boolean;
  }> = [];

  async backfill() {
    return ok(undefined);
  }

  async backfillMany(
    _context: IExecutionContext,
    input: {
      table: Table;
      fields: ReadonlyArray<Field>;
      skipDistinctFilter?: boolean;
      includeOneManyTwoWay?: boolean;
    }
  ) {
    this.calls.push({
      table: input.table,
      fields: input.fields,
      skipDistinctFilter: input.skipDistinctFilter,
      includeOneManyTwoWay: input.includeOneManyTwoWay,
    });
    return ok({ fields: input.fields });
  }

  async executeSync() {
    return ok(undefined);
  }

  async executeSyncMany() {
    return ok({ fields: [] });
  }
}

class FakeComputedFieldCascadeService {
  async cascade() {
    return ok(undefined);
  }
}

class FakeFieldDependencyGraph {
  async load() {
    return ok({ fieldsById: new Map(), edges: [] });
  }
}

class FakeTableRepository {
  constructor(private readonly tables: Table[] = []) {}

  async findOne(
    _context: IExecutionContext,
    spec: { isSatisfiedBy(table: Table): boolean } | TableByIdSpec
  ) {
    const table = this.tables.find((candidate) => spec.isSatisfiedBy(candidate));
    if (!table) {
      throw new Error('Table not found');
    }
    return ok(table);
  }

  async find() {
    return ok(this.tables);
  }

  async insert() {
    return ok(undefined);
  }

  async insertMany() {
    return ok([]);
  }

  async updateOne() {
    return ok(undefined);
  }

  async delete() {
    return ok(undefined);
  }
}

class FakeComputedUpdatePlanner {
  async plan() {
    return ok({ steps: [], edges: [], sameTableBatches: [] });
  }
}

const collectFinalCheckResults = async (
  generator: ReturnType<ReturnType<typeof createSchemaChecker>['checkTable']>
) => {
  const results = [];
  for await (const result of generator) {
    if (result.status === 'pending' || result.status === 'running') {
      continue;
    }
    results.push(result);
  }
  return results;
};

describe('PostgresTableSchemaRepository', () => {
  let pglite: PGlite;
  let db: Kysely<V1TeableDatabase>;

  beforeAll(async () => {
    pglite = await PGlite.create();
    db = new Kysely<V1TeableDatabase>({
      dialect: new PGliteDialect(pglite),
    });

    await createReferenceTable(db);
    await installUndoCaptureGlobals(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('triggers computed backfill after adding fields', async () => {
    const baseId = BaseId.generate()._unsafeUnwrap();
    const tableId = TableId.generate()._unsafeUnwrap();
    const tableName = TableName.create('Backfill')._unsafeUnwrap();
    const fieldName = FieldName.create('Name')._unsafeUnwrap();
    const actorId = ActorId.create('system')._unsafeUnwrap();
    const context: IExecutionContext = { actorId };

    const builder = Table.builder().withBaseId(baseId).withId(tableId).withName(tableName);
    builder.field().singleLineText().withName(fieldName).done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();

    const backfillService = new FakeComputedFieldBackfillService();
    const tableRepository = new FakeTableRepository([table]);
    const repository = new PostgresTableSchemaRepository(
      db,
      tableRepository as never,
      backfillService,
      new FakeComputedFieldCascadeService(),
      new FakeComputedUpdatePlanner() as never,
      new FakeFieldDependencyGraph() as never
    );

    const insertResult = await repository.insert(context, table);
    insertResult._unsafeUnwrap();

    const newFieldId = FieldId.generate()._unsafeUnwrap();
    const newFieldName = FieldName.create('New Field')._unsafeUnwrap();
    const newFieldResult = createSingleLineTextField({ id: newFieldId, name: newFieldName });
    newFieldResult._unsafeUnwrap();

    const updateResult = table.update((mutator) =>
      mutator.addField(newFieldResult._unsafeUnwrap())
    );
    updateResult._unsafeUnwrap();

    const updateCall = await repository.update(
      context,
      updateResult._unsafeUnwrap().table,
      updateResult._unsafeUnwrap().mutateSpec
    );
    updateCall._unsafeUnwrap();

    expect(backfillService.calls).toHaveLength(1);
    expect(backfillService.calls[0]?.fields[0]?.id().equals(newFieldId)).toBe(true);
    expect(backfillService.calls[0]?.skipDistinctFilter).toBe(true);
    expect(backfillService.calls[0]?.includeOneManyTwoWay).toBe(false);
  });

  it('creates a table whose schema checker reports no warn or error results', async () => {
    const baseId = BaseId.generate()._unsafeUnwrap();
    const tableId = TableId.generate()._unsafeUnwrap();
    const tableName = TableName.create('Schema Clean')._unsafeUnwrap();
    const fieldName = FieldName.create('Name')._unsafeUnwrap();
    const actorId = ActorId.create('system')._unsafeUnwrap();
    const context: IExecutionContext = { actorId };

    const builder = Table.builder().withBaseId(baseId).withId(tableId).withName(tableName);
    builder.field().singleLineText().withName(fieldName).done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();

    const tableRepository = new FakeTableRepository([table]);
    const repository = new PostgresTableSchemaRepository(
      db,
      tableRepository as never,
      new FakeComputedFieldBackfillService(),
      new FakeComputedFieldCascadeService(),
      new FakeComputedUpdatePlanner() as never,
      new FakeFieldDependencyGraph() as never
    );

    (await repository.insert(context, table))._unsafeUnwrap();

    const checker = createSchemaChecker({
      db,
      introspector: new PostgresSchemaIntrospector(db),
      schema: baseId.toString(),
    });

    const results = await collectFinalCheckResults(checker.checkTable(table));

    expect(
      results.filter((result) => result.status === 'error' || result.status === 'warn')
    ).toEqual([]);
  });

  it('creates generated system field columns directly during table creation', async () => {
    const baseId = BaseId.generate()._unsafeUnwrap();
    const tableId = TableId.generate()._unsafeUnwrap();
    const tableName = TableName.create('Generated Columns')._unsafeUnwrap();
    const actorId = ActorId.create('system')._unsafeUnwrap();
    const context: IExecutionContext = { actorId };

    const builder = Table.builder().withBaseId(baseId).withId(tableId).withName(tableName);
    builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
    builder.field().createdBy().withName(FieldName.create('Creator')._unsafeUnwrap()).done();
    builder.field().autoNumber().withName(FieldName.create('No')._unsafeUnwrap()).done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();

    const tableRepository = new FakeTableRepository([table]);
    const repository = new PostgresTableSchemaRepository(
      db,
      tableRepository as never,
      new FakeComputedFieldBackfillService(),
      new FakeComputedFieldCascadeService(),
      new FakeComputedUpdatePlanner() as never,
      new FakeFieldDependencyGraph() as never
    );

    (await repository.insert(context, table))._unsafeUnwrap();

    const { schema, tableName: dbTableName } = table
      .dbTableName()
      .andThen((name) => name.split({ defaultSchema: null }))
      ._unsafeUnwrap();
    const introspector = new PostgresSchemaIntrospector(db);
    const generatedFields = table.getFields().filter((field) => {
      const persistedResult =
        'isPersistedAsGeneratedColumn' in field ? field.isPersistedAsGeneratedColumn() : ok(false);
      return persistedResult.isOk() && persistedResult.value;
    });

    for (const field of generatedFields) {
      const columnName = field
        .dbFieldName()
        .andThen((name) => name.value())
        ._unsafeUnwrap();
      const column = (
        await introspector.getColumn(schema, dbTableName, columnName)
      )._unsafeUnwrap();
      expect(column?.isGenerated).toBe(true);
    }

    const createdByField = table
      .getFields()
      .find((field) => field.type().toString() === 'createdBy');
    const createdByColumnName = createdByField
      ?.dbFieldName()
      .andThen((name) => name.value())
      ._unsafeUnwrap();
    if (!createdByColumnName) {
      throw new Error('Created By field missing');
    }
    const createdByColumn = (
      await introspector.getColumn(schema, dbTableName, createdByColumnName)
    )._unsafeUnwrap();
    expect(createdByColumn?.isGenerated).toBe(false);

    const checker = createSchemaChecker({
      db,
      introspector,
      schema: baseId.toString(),
    });
    const results = await collectFinalCheckResults(checker.checkTable(table));

    expect(
      results.filter((result) => result.status === 'error' || result.status === 'warn')
    ).toEqual([]);
  });

  it('ensures an existing table schema without recreating it', async () => {
    const baseId = BaseId.generate()._unsafeUnwrap();
    const tableId = TableId.generate()._unsafeUnwrap();
    const tableName = TableName.create('Ensure Existing')._unsafeUnwrap();
    const fieldName = FieldName.create('Name')._unsafeUnwrap();
    const actorId = ActorId.create('system')._unsafeUnwrap();
    const context: IExecutionContext = { actorId };

    const builder = Table.builder().withBaseId(baseId).withId(tableId).withName(tableName);
    builder.field().singleLineText().withName(fieldName).done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();

    const tableRepository = new FakeTableRepository([table]);
    const repository = new PostgresTableSchemaRepository(
      db,
      tableRepository as never,
      new FakeComputedFieldBackfillService(),
      new FakeComputedFieldCascadeService(),
      new FakeComputedUpdatePlanner() as never,
      new FakeFieldDependencyGraph() as never
    );

    (await repository.ensureInserted(context, table))._unsafeUnwrap();
    (await repository.ensureInserted(context, table))._unsafeUnwrap();

    const { schema, tableName: dbTableName } = table
      .dbTableName()
      .andThen((name) => name.split({ defaultSchema: null }))
      ._unsafeUnwrap();
    const introspector = new PostgresSchemaIntrospector(db);
    const exists = await introspector.tableExists(schema, dbTableName);

    expect(exists._unsafeUnwrap()).toBe(true);

    const dbFieldName = table
      .getFields()[0]!
      .dbFieldName()
      .andThen((name) => name.value())
      ._unsafeUnwrap();

    await sql`ALTER TABLE ${sql.raw(`"${schema ?? 'public'}"."${dbTableName}"`)}
      DROP COLUMN ${sql.raw(`"${dbFieldName}"`)}`.execute(db);

    const missingColumn = await introspector.columnExists(schema, dbTableName, dbFieldName);
    expect(missingColumn._unsafeUnwrap()).toBe(false);

    (await repository.ensureInserted(context, table))._unsafeUnwrap();

    const repairedColumn = await introspector.columnExists(schema, dbTableName, dbFieldName);
    expect(repairedColumn._unsafeUnwrap()).toBe(true);
  });

  it('executes reference metadata statements on the meta DB when databases are split', async () => {
    const dataPglite = await PGlite.create();
    const metaPglite = await PGlite.create();
    const dataDb = new Kysely<V1TeableDatabase>({
      dialect: new PGliteDialect(dataPglite),
    });
    const metaDb = new Kysely<V1TeableDatabase>({
      dialect: new PGliteDialect(metaPglite),
    });

    try {
      await installUndoCaptureGlobals(dataDb);
      await createReferenceTable(metaDb);
      await createFieldMetaTable(metaDb);

      const baseId = BaseId.generate()._unsafeUnwrap();
      const actorId = ActorId.create('system')._unsafeUnwrap();
      const context: IExecutionContext = { actorId };

      const hostTableBuilder = Table.builder()
        .withBaseId(baseId)
        .withId(TableId.generate()._unsafeUnwrap())
        .withName(TableName.create('Split Host')._unsafeUnwrap());
      hostTableBuilder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .done();
      hostTableBuilder.view().defaultGrid().done();
      const hostTable = hostTableBuilder.build()._unsafeUnwrap();

      const foreignTableBuilder = Table.builder()
        .withBaseId(baseId)
        .withId(TableId.generate()._unsafeUnwrap())
        .withName(TableName.create('Split Foreign')._unsafeUnwrap());
      foreignTableBuilder
        .field()
        .singleLineText()
        .withName(FieldName.create('Title')._unsafeUnwrap())
        .done();
      foreignTableBuilder.view().defaultGrid().done();
      const foreignTable = foreignTableBuilder.build()._unsafeUnwrap();
      const foreignPrimaryFieldId = foreignTable.getFields()[0]?.id();
      if (!foreignPrimaryFieldId) {
        throw new Error('Foreign table primary field missing');
      }

      const tableRepository = new FakeTableRepository([hostTable, foreignTable]);
      const repository = new PostgresTableSchemaRepository(
        dataDb,
        tableRepository as never,
        new FakeComputedFieldBackfillService(),
        new FakeComputedFieldCascadeService(),
        new FakeComputedUpdatePlanner() as never,
        new FakeFieldDependencyGraph() as never,
        metaDb
      );

      (await repository.insert(context, hostTable))._unsafeUnwrap();
      (await repository.insert(context, foreignTable))._unsafeUnwrap();

      const linkFieldId = FieldId.generate()._unsafeUnwrap();
      const symmetricFieldId = FieldId.generate()._unsafeUnwrap();
      const linkDbConfig = LinkFieldConfig.buildDbConfig({
        fkHostTableName: DbTableName.rehydrate(
          `${baseId.toString()}.${foreignTable.id().toString()}`
        )._unsafeUnwrap(),
        relationship: LinkRelationship.oneMany(),
        fieldId: linkFieldId,
        symmetricFieldId,
      })._unsafeUnwrap();
      const linkConfig = LinkFieldConfig.create({
        relationship: 'oneMany',
        foreignTableId: foreignTable.id().toString(),
        lookupFieldId: foreignPrimaryFieldId.toString(),
        isOneWay: false,
        symmetricFieldId: symmetricFieldId.toString(),
        fkHostTableName: linkDbConfig.fkHostTableName.value()._unsafeUnwrap(),
        selfKeyName: linkDbConfig.selfKeyName.value()._unsafeUnwrap(),
        foreignKeyName: linkDbConfig.foreignKeyName.value()._unsafeUnwrap(),
      })._unsafeUnwrap();
      const newLinkField = createLinkField({
        id: linkFieldId,
        name: FieldName.create('Foreign link')._unsafeUnwrap(),
        config: linkConfig,
        meta: LinkFieldMeta.create({ hasOrderColumn: true })._unsafeUnwrap(),
      })._unsafeUnwrap();
      await sql`insert into "field" ("id", "meta") values (${linkFieldId.toString()}, '{}')`.execute(
        metaDb
      );

      const updateResult = hostTable.update((mutator) => mutator.addField(newLinkField));
      updateResult._unsafeUnwrap();

      const updateCall = await repository.update(
        context,
        updateResult._unsafeUnwrap().table,
        updateResult._unsafeUnwrap().mutateSpec
      );
      updateCall._unsafeUnwrap();

      const referenceRows = await metaDb
        .selectFrom('reference')
        .select(['to_field_id', 'from_field_id'])
        .execute();

      expect(referenceRows).toEqual([
        {
          to_field_id: linkFieldId.toString(),
          from_field_id: foreignPrimaryFieldId.toString(),
        },
      ]);

      const fieldMeta = await metaDb
        .selectFrom('field')
        .select('meta')
        .where('id', '=', linkFieldId.toString())
        .executeTakeFirstOrThrow();
      const fieldMetaValue =
        typeof fieldMeta.meta === 'string' ? JSON.parse(fieldMeta.meta) : fieldMeta.meta;
      expect(fieldMetaValue).toEqual({ hasOrderColumn: true });
    } finally {
      await dataDb.destroy();
      await metaDb.destroy();
    }
  });

  it('passes includeOneManyTwoWay=true when adding two-way oneMany link field', async () => {
    const baseId = BaseId.generate()._unsafeUnwrap();
    const actorId = ActorId.create('system')._unsafeUnwrap();
    const context: IExecutionContext = { actorId };

    const hostTableBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(TableId.generate()._unsafeUnwrap())
      .withName(TableName.create('Host')._unsafeUnwrap());
    hostTableBuilder
      .field()
      .singleLineText()
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .done();
    hostTableBuilder.view().defaultGrid().done();
    const hostTable = hostTableBuilder.build()._unsafeUnwrap();

    const foreignTableBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(TableId.generate()._unsafeUnwrap())
      .withName(TableName.create('Foreign')._unsafeUnwrap());
    foreignTableBuilder
      .field()
      .singleLineText()
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .done();
    foreignTableBuilder.view().defaultGrid().done();
    const foreignTable = foreignTableBuilder.build()._unsafeUnwrap();
    const foreignPrimaryFieldId = foreignTable.getFields()[0]?.id();
    if (!foreignPrimaryFieldId) {
      throw new Error('Foreign table primary field missing');
    }

    const backfillService = new FakeComputedFieldBackfillService();
    const tableRepository = new FakeTableRepository([hostTable, foreignTable]);
    const repository = new PostgresTableSchemaRepository(
      db,
      tableRepository as never,
      backfillService,
      new FakeComputedFieldCascadeService(),
      new FakeComputedUpdatePlanner() as never,
      new FakeFieldDependencyGraph() as never
    );

    (await repository.insert(context, hostTable))._unsafeUnwrap();
    (await repository.insert(context, foreignTable))._unsafeUnwrap();

    const linkFieldId = FieldId.generate()._unsafeUnwrap();
    const symmetricFieldId = FieldId.generate()._unsafeUnwrap();
    const linkFieldName = FieldName.create('Parent')._unsafeUnwrap();
    const linkDbConfig = LinkFieldConfig.buildDbConfig({
      fkHostTableName: DbTableName.rehydrate(
        `${baseId.toString()}.${foreignTable.id().toString()}`
      )._unsafeUnwrap(),
      relationship: LinkRelationship.oneMany(),
      fieldId: linkFieldId,
      symmetricFieldId,
      isOneWay: false,
    })._unsafeUnwrap();
    const linkConfig = LinkFieldConfig.create({
      relationship: 'oneMany',
      foreignTableId: foreignTable.id().toString(),
      lookupFieldId: foreignPrimaryFieldId.toString(),
      isOneWay: false,
      symmetricFieldId: symmetricFieldId.toString(),
      fkHostTableName: linkDbConfig.fkHostTableName.value()._unsafeUnwrap(),
      selfKeyName: linkDbConfig.selfKeyName.value()._unsafeUnwrap(),
      foreignKeyName: linkDbConfig.foreignKeyName.value()._unsafeUnwrap(),
    })._unsafeUnwrap();
    const newLinkField = createLinkField({
      id: linkFieldId,
      name: linkFieldName,
      config: linkConfig,
    })._unsafeUnwrap();

    const updateResult = hostTable.update((mutator) => mutator.addField(newLinkField));
    updateResult._unsafeUnwrap();

    const updateCall = await repository.update(
      context,
      updateResult._unsafeUnwrap().table,
      updateResult._unsafeUnwrap().mutateSpec
    );
    updateCall._unsafeUnwrap();

    expect(backfillService.calls).toHaveLength(1);
    expect(backfillService.calls[0]?.fields[0]?.id().equals(linkFieldId)).toBe(true);
    expect(backfillService.calls[0]?.includeOneManyTwoWay).toBe(true);
  });

  it('creates batch table schemas when a two-way oneMany link stores FK on a later table', async () => {
    const baseId = BaseId.generate()._unsafeUnwrap();
    const actorId = ActorId.create('system')._unsafeUnwrap();
    const context: IExecutionContext = { actorId };

    const hostTableBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(TableId.generate()._unsafeUnwrap())
      .withName(TableName.create('Batch Host')._unsafeUnwrap());
    hostTableBuilder
      .field()
      .singleLineText()
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .done();
    hostTableBuilder.view().defaultGrid().done();
    const hostTable = hostTableBuilder.build()._unsafeUnwrap();

    const foreignTableBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(TableId.generate()._unsafeUnwrap())
      .withName(TableName.create('Batch Foreign')._unsafeUnwrap());
    foreignTableBuilder
      .field()
      .singleLineText()
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .done();
    foreignTableBuilder.view().defaultGrid().done();
    const foreignTable = foreignTableBuilder.build()._unsafeUnwrap();
    const foreignPrimaryFieldId = foreignTable.getFields()[0]?.id();
    if (!foreignPrimaryFieldId) {
      throw new Error('Foreign table primary field missing');
    }

    const linkFieldId = FieldId.generate()._unsafeUnwrap();
    const symmetricFieldId = FieldId.generate()._unsafeUnwrap();
    const linkDbConfig = LinkFieldConfig.buildDbConfig({
      fkHostTableName: DbTableName.rehydrate(
        `${baseId.toString()}.${foreignTable.id().toString()}`
      )._unsafeUnwrap(),
      relationship: LinkRelationship.oneMany(),
      fieldId: linkFieldId,
      symmetricFieldId,
      isOneWay: false,
    })._unsafeUnwrap();
    const linkConfig = LinkFieldConfig.create({
      relationship: 'oneMany',
      foreignTableId: foreignTable.id().toString(),
      lookupFieldId: foreignPrimaryFieldId.toString(),
      isOneWay: false,
      symmetricFieldId: symmetricFieldId.toString(),
      fkHostTableName: linkDbConfig.fkHostTableName.value()._unsafeUnwrap(),
      selfKeyName: linkDbConfig.selfKeyName.value()._unsafeUnwrap(),
      foreignKeyName: linkDbConfig.foreignKeyName.value()._unsafeUnwrap(),
    })._unsafeUnwrap();
    const linkField = createLinkField({
      id: linkFieldId,
      name: FieldName.create('Foreign')._unsafeUnwrap(),
      config: linkConfig,
    })._unsafeUnwrap();

    const hostWithLink = hostTable
      .update((mutator) => mutator.addField(linkField))
      ._unsafeUnwrap().table;

    const tableRepository = new FakeTableRepository([hostWithLink, foreignTable]);
    const repository = new PostgresTableSchemaRepository(
      db,
      tableRepository as never,
      new FakeComputedFieldBackfillService(),
      new FakeComputedFieldCascadeService(),
      new FakeComputedUpdatePlanner() as never,
      new FakeFieldDependencyGraph() as never
    );

    const result = await repository.insertMany(context, [hostWithLink, foreignTable]);
    result._unsafeUnwrap();

    const fkColumnName = linkDbConfig.selfKeyName.value()._unsafeUnwrap();
    const columnResult = await db
      .selectFrom('information_schema.columns')
      .select('column_name')
      .where('table_schema', '=', baseId.toString())
      .where('table_name', '=', foreignTable.id().toString())
      .where('column_name', '=', fkColumnName)
      .executeTakeFirst();

    expect(columnResult?.column_name).toBe(fkColumnName);
  });

  it('does not reinstall undo capture triggers after batch table creation in a transaction', async () => {
    const pglite = await PGlite.create();
    const dialect = new PGliteDialect(pglite);
    const db = new Kysely<V1TeableDatabase>({ dialect });

    try {
      await installUndoCaptureGlobals(db);

      const baseId = BaseId.generate()._unsafeUnwrap();
      const actorId = ActorId.create('system')._unsafeUnwrap();
      const context: IExecutionContext = { actorId };
      const tables = ['Batch Undo A', 'Batch Undo B'].map((name) => {
        const builder = Table.builder()
          .withBaseId(baseId)
          .withId(TableId.generate()._unsafeUnwrap())
          .withName(TableName.create(name)._unsafeUnwrap());
        builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
        builder.view().defaultGrid().done();
        return builder.build()._unsafeUnwrap();
      });

      const repository = new PostgresTableSchemaRepository(
        db,
        new FakeTableRepository(tables) as never,
        new FakeComputedFieldBackfillService(),
        new FakeComputedFieldCascadeService(),
        new FakeComputedUpdatePlanner() as never,
        new FakeFieldDependencyGraph() as never
      );
      dialect.driver.queries.length = 0;

      await db.transaction().execute(async (trx) => {
        const result = await repository.insertMany(
          { ...context, transaction: new PostgresUnitOfWorkTransaction(trx as never) },
          tables
        );
        result._unsafeUnwrap();
      });

      const triggerInstallQueries = dialect.driver.queries.filter((query) =>
        query.sql.includes('CREATE OR REPLACE TRIGGER "__teable_undo_capture"')
      );

      expect(triggerInstallQueries).toHaveLength(tables.length);
    } finally {
      await db.destroy();
    }
  });

  it('deduplicates schema creation and can skip undo capture setup for batch table import', async () => {
    const pglite = await PGlite.create();
    const dialect = new PGliteDialect(pglite);
    const db = new Kysely<V1TeableDatabase>({ dialect });

    try {
      await installUndoCaptureGlobals(db);

      const baseId = BaseId.generate()._unsafeUnwrap();
      const actorId = ActorId.create('system')._unsafeUnwrap();
      const context: IExecutionContext = { actorId };
      const tables = ['Batch Import A', 'Batch Import B'].map((name) => {
        const builder = Table.builder()
          .withBaseId(baseId)
          .withId(TableId.generate()._unsafeUnwrap())
          .withName(TableName.create(name)._unsafeUnwrap());
        builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
        builder.view().defaultGrid().done();
        return builder.build()._unsafeUnwrap();
      });

      const repository = new PostgresTableSchemaRepository(
        db,
        new FakeTableRepository(tables) as never,
        new FakeComputedFieldBackfillService(),
        new FakeComputedFieldCascadeService(),
        new FakeComputedUpdatePlanner() as never,
        new FakeFieldDependencyGraph() as never
      );
      dialect.driver.queries.length = 0;

      await db.transaction().execute(async (trx) => {
        const result = await repository.insertMany(
          { ...context, transaction: new PostgresUnitOfWorkTransaction(trx as never) },
          tables,
          { optimizeForEmptyTables: true, skipUndoCaptureSetup: true }
        );
        result._unsafeUnwrap();
      });

      const createSchemaQueries = dialect.driver.queries.filter((query) =>
        query.sql.includes(`create schema if not exists "${baseId.toString()}"`)
      );
      const triggerProbeQueries = dialect.driver.queries.filter((query) =>
        query.sql.includes('FROM pg_trigger AS t')
      );
      const triggerInstallQueries = dialect.driver.queries.filter((query) =>
        query.sql.includes('CREATE OR REPLACE TRIGGER "__teable_undo_capture"')
      );

      expect(createSchemaQueries).toHaveLength(1);
      expect(triggerProbeQueries).toHaveLength(0);
      expect(triggerInstallQueries).toHaveLength(0);
    } finally {
      await db.destroy();
    }
  });

  it('routes batch reference metadata statements to the meta DB when databases are split', async () => {
    const dataPglite = await PGlite.create();
    const metaPglite = await PGlite.create();
    const dataDb = new Kysely<V1TeableDatabase>({
      dialect: new PGliteDialect(dataPglite),
    });
    const metaDb = new Kysely<V1TeableDatabase>({
      dialect: new PGliteDialect(metaPglite),
    });

    try {
      await installUndoCaptureGlobals(dataDb);
      await createReferenceTable(metaDb);

      const baseId = BaseId.generate()._unsafeUnwrap();
      const actorId = ActorId.create('system')._unsafeUnwrap();
      const context: IExecutionContext = { actorId };

      const hostTableBuilder = Table.builder()
        .withBaseId(baseId)
        .withId(TableId.generate()._unsafeUnwrap())
        .withName(TableName.create('Batch Split Host')._unsafeUnwrap());
      hostTableBuilder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .done();
      hostTableBuilder.view().defaultGrid().done();
      const hostTable = hostTableBuilder.build()._unsafeUnwrap();

      const foreignTableBuilder = Table.builder()
        .withBaseId(baseId)
        .withId(TableId.generate()._unsafeUnwrap())
        .withName(TableName.create('Batch Split Foreign')._unsafeUnwrap());
      foreignTableBuilder
        .field()
        .singleLineText()
        .withName(FieldName.create('Title')._unsafeUnwrap())
        .done();
      foreignTableBuilder.view().defaultGrid().done();
      const foreignTable = foreignTableBuilder.build()._unsafeUnwrap();
      const foreignPrimaryFieldId = foreignTable.getFields()[0]?.id();
      if (!foreignPrimaryFieldId) {
        throw new Error('Foreign table primary field missing');
      }

      const linkFieldId = FieldId.generate()._unsafeUnwrap();
      const symmetricFieldId = FieldId.generate()._unsafeUnwrap();
      const linkDbConfig = LinkFieldConfig.buildDbConfig({
        fkHostTableName: DbTableName.rehydrate(
          `${baseId.toString()}.${foreignTable.id().toString()}`
        )._unsafeUnwrap(),
        relationship: LinkRelationship.oneMany(),
        fieldId: linkFieldId,
        symmetricFieldId,
        isOneWay: false,
      })._unsafeUnwrap();
      const linkConfig = LinkFieldConfig.create({
        relationship: 'oneMany',
        foreignTableId: foreignTable.id().toString(),
        lookupFieldId: foreignPrimaryFieldId.toString(),
        isOneWay: false,
        symmetricFieldId: symmetricFieldId.toString(),
        fkHostTableName: linkDbConfig.fkHostTableName.value()._unsafeUnwrap(),
        selfKeyName: linkDbConfig.selfKeyName.value()._unsafeUnwrap(),
        foreignKeyName: linkDbConfig.foreignKeyName.value()._unsafeUnwrap(),
      })._unsafeUnwrap();
      const linkField = createLinkField({
        id: linkFieldId,
        name: FieldName.create('Foreign')._unsafeUnwrap(),
        config: linkConfig,
      })._unsafeUnwrap();
      const hostWithLink = hostTable
        .update((mutator) => mutator.addField(linkField))
        ._unsafeUnwrap().table;

      const tableRepository = new FakeTableRepository([hostWithLink, foreignTable]);
      const repository = new PostgresTableSchemaRepository(
        dataDb,
        tableRepository as never,
        new FakeComputedFieldBackfillService(),
        new FakeComputedFieldCascadeService(),
        new FakeComputedUpdatePlanner() as never,
        new FakeFieldDependencyGraph() as never,
        metaDb
      );

      const result = await repository.insertMany(context, [hostWithLink, foreignTable]);
      result._unsafeUnwrap();

      const referenceRows = await metaDb
        .selectFrom('reference')
        .select(['to_field_id', 'from_field_id'])
        .execute();

      expect(referenceRows).toEqual([
        {
          to_field_id: linkFieldId.toString(),
          from_field_id: foreignPrimaryFieldId.toString(),
        },
      ]);

      await expect(
        dataDb.selectFrom('reference').select(['to_field_id', 'from_field_id']).execute()
      ).rejects.toThrow(/relation "reference" does not exist|does not exist/i);
    } finally {
      await dataDb.destroy();
      await metaDb.destroy();
    }
  });
});
