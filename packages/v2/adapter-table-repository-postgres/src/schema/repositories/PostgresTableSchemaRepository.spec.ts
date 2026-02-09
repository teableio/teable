import { PGlite } from '@electric-sql/pglite';
import {
  ActorId,
  BaseId,
  createSingleLineTextField,
  FieldId,
  FieldName,
  type Field,
  type IExecutionContext,
  Table,
  TableId,
  TableName,
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
  calls: Array<{ table: Table; fields: ReadonlyArray<Field> }> = [];

  async backfill() {
    return ok(undefined);
  }

  async backfillMany(
    _context: IExecutionContext,
    input: { table: Table; fields: ReadonlyArray<Field> }
  ) {
    this.calls.push({ table: input.table, fields: input.fields });
    return ok(undefined);
  }

  async executeSync() {
    return ok(undefined);
  }

  async executeSyncMany() {
    return ok(undefined);
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
    const repository = new PostgresTableSchemaRepository(db, backfillService);

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
  });
});
