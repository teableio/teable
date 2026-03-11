import { PGlite } from '@electric-sql/pglite';
import {
  ActorId,
  BaseId,
  createLinkField,
  createSingleLineTextField,
  FieldId,
  LinkFieldConfig,
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
  type Dialect,
  type QueryResult,
} from 'kysely';
import { ok } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresTableSchemaRepository } from './PostgresTableSchemaRepository';

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

  async init() {
    await Promise.resolve();
  }

  async releaseConnection(_connection: PGliteConnection) {
    await Promise.resolve();
  }
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
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  createDriver() {
    return new PGliteDriver(this.#client);
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

class FakeComputedFieldBackfillService {
  calls: Array<{
    table: Table;
    fields: ReadonlyArray<Field>;
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
      includeOneManyTwoWay?: boolean;
    }
  ) {
    this.calls.push({
      table: input.table,
      fields: input.fields,
      includeOneManyTwoWay: input.includeOneManyTwoWay,
    });
    return ok(undefined);
  }

  async executeSync() {
    return ok(undefined);
  }

  async executeSyncMany() {
    return ok(undefined);
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

describe('PostgresTableSchemaRepository', () => {
  let pglite: PGlite;
  let db: Kysely<V1TeableDatabase>;

  beforeAll(async () => {
    pglite = await PGlite.create();
    db = new Kysely<V1TeableDatabase>({
      dialect: new PGliteDialect(pglite),
    });

    await db.schema
      .createTable('reference')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('to_field_id', 'text')
      .addColumn('from_field_id', 'text')
      .addUniqueConstraint('reference_to_from_unique', ['to_field_id', 'from_field_id'])
      .execute();
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
    expect(backfillService.calls[0]?.includeOneManyTwoWay).toBe(false);
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
    const linkConfig = LinkFieldConfig.create({
      relationship: 'oneMany',
      foreignTableId: foreignTable.id().toString(),
      lookupFieldId: foreignPrimaryFieldId.toString(),
      isOneWay: false,
      symmetricFieldId: symmetricFieldId.toString(),
      fkHostTableName: `junction_${linkFieldId.toString()}_${symmetricFieldId.toString()}`,
      selfKeyName: `__fk_${symmetricFieldId.toString()}`,
      foreignKeyName: '__id',
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
});
