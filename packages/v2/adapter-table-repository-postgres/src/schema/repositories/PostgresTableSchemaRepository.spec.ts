import { PGlite } from '@electric-sql/pglite';
import { PostgresUnitOfWorkTransaction } from '@teable/v2-adapter-db-postgres-shared';
import {
  ActorId,
  BaseId,
  createLinkField,
  createSingleLineTextField,
  DbTableName,
  DbFieldName,
  FieldId,
  FormulaExpression,
  FormulaField,
  CellValueType,
  CellValueMultiplicity,
  UpdateFormulaExpressionSpec,
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
import {
  createFormulaCompileBudgetPolicy,
  defaultFormulaCompileBudgetLimits,
  Pg16TypeValidationStrategy,
} from '@teable/v2-formula-sql-pg';
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
  type RawBuilder,
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

  describe('actor storage', () => {
    const actorColumns = [
      '__created_by_actor_type',
      '__created_by_actor_id',
      '__last_modified_by_actor_type',
      '__last_modified_by_actor_id',
    ];
    const context: IExecutionContext = { actorId: ActorId.create('system')._unsafeUnwrap() };
    type ActorStorageFixture = {
      table: Table;
      target: RawBuilder<unknown>;
      repository: PostgresTableSchemaRepository;
      schema: string | null;
      tableName: string;
    };
    const fixture = (): ActorStorageFixture => {
      const builder = Table.builder()
        .withBaseId(BaseId.generate()._unsafeUnwrap())
        .withName(TableName.create('Actor storage')._unsafeUnwrap());
      builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
      builder.view().defaultGrid().done();
      const table = builder.build()._unsafeUnwrap();
      const location = table
        .dbTableName()
        .andThen((name) => name.split({ defaultSchema: 'public' }))
        ._unsafeUnwrap();
      const target = sql.id(location.schema ?? 'public', location.tableName);
      const repository = new PostgresTableSchemaRepository(
        db,
        new FakeTableRepository([table]) as never,
        new FakeComputedFieldBackfillService(),
        new FakeComputedFieldCascadeService(),
        new FakeComputedUpdatePlanner() as never,
        new FakeFieldDependencyGraph() as never
      );
      return { table, target, repository, ...location };
    };
    const createLegacy = async (input: ActorStorageFixture) => {
      await db.schema
        .createSchema(input.schema ?? 'public')
        .ifNotExists()
        .execute();
      await sql`CREATE TABLE ${input.target} (
        __id text NOT NULL UNIQUE, __auto_number serial PRIMARY KEY,
        __created_time timestamptz NOT NULL DEFAULT now(), __last_modified_time timestamptz,
        __created_by text NOT NULL, __last_modified_by text, __version integer NOT NULL
      )`.execute(db);
      await sql`INSERT INTO ${input.target} (__id, __created_by, __version)
        VALUES ('legacy-row', 'native-executor', 1)`.execute(db);
    };
    const physicalColumns = async (input: ActorStorageFixture) => {
      const result = await sql<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>`SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = ${input.schema ?? 'public'} AND table_name = ${input.tableName}
          AND column_name IN (${sql.join(actorColumns)})
        ORDER BY column_name`.execute(db);
      return result.rows;
    };
    const enable = async (input: ActorStorageFixture, expectedConflict?: { code: string }) => {
      const rollback = new Error('rollback expected actor conflict');
      await db
        .transaction()
        .execute(async (trx) => {
          const result = await input.repository.ensureActorColumns(
            { ...context, transaction: new PostgresUnitOfWorkTransaction(trx as never) },
            input.table
          );
          if (expectedConflict) {
            const error = result._unsafeUnwrapErr();
            expect(error.code).toBe(expectedConflict.code);
            expect(error.tags).toContain('conflict');
            expect(JSON.stringify(error)).not.toContain(input.tableName);
            expect(JSON.stringify(error)).not.toContain('business-value');
            throw rollback;
          }
          result._unsafeUnwrap();
        })
        .catch((error: unknown) => {
          if (error !== rollback) throw error;
        });
    };
    const assertPairChecks = async (input: ActorStorageFixture, rowId: string) => {
      for (const [typeColumn, idColumn] of [
        ['__created_by_actor_type', '__created_by_actor_id'],
        ['__last_modified_by_actor_type', '__last_modified_by_actor_id'],
      ] as const) {
        for (const [type, id] of [
          ['user', null],
          [null, 'principal'],
          ['', 'principal'],
          ['user', ''],
        ] as const) {
          await expect(
            sql`UPDATE ${input.target} SET ${sql.id(typeColumn)} = ${type},
              ${sql.id(idColumn)} = ${id} WHERE __id = ${rowId}`.execute(db)
          ).rejects.toThrow(/check constraint/i);
        }
        for (const type of ['user', 'appUser', 'automation', 'system', 'future-kind']) {
          await sql`UPDATE ${input.target} SET ${sql.id(typeColumn)} = ${type},
            ${sql.id(idColumn)} = ${`${type}-principal`} WHERE __id = ${rowId}`.execute(db);
          const stored = await sql<{ actor_type: string; actor_id: string }>`
            SELECT ${sql.id(typeColumn)} AS actor_type, ${sql.id(idColumn)} AS actor_id
            FROM ${input.target} WHERE __id = ${rowId}`.execute(db);
          expect(stored.rows).toEqual([{ actor_type: type, actor_id: `${type}-principal` }]);
        }
        await sql`UPDATE ${input.target} SET ${sql.id(typeColumn)} = NULL,
          ${sql.id(idColumn)} = NULL WHERE __id = ${rowId}`.execute(db);
      }
    };

    it.each(['insert', 'insertMany'] as const)(
      'creates nullable text actor columns and strict pair checks through %s',
      async (method) => {
        const input = fixture();
        const result =
          method === 'insert'
            ? await input.repository.insert(context, input.table)
            : await input.repository.insertMany(context, [input.table]);
        result._unsafeUnwrap();
        expect(await physicalColumns(input)).toEqual(
          [...actorColumns].sort().map((column_name) => ({
            column_name,
            data_type: 'text',
            is_nullable: 'YES',
            column_default: null,
          }))
        );
        await sql`INSERT INTO ${input.target} (__id, __created_by, __version)
          VALUES ('new-row', 'native-executor', 1)`.execute(db);
        await assertPairChecks(input, 'new-row');
      }
    );

    it('leaves populated legacy tables unchanged until explicitly enabled and converges on retry', async () => {
      const input = fixture();
      await createLegacy(input);
      (await input.repository.ensurePhysicalTable(context, input.table))._unsafeUnwrap();
      (await input.repository.ensureInserted(context, input.table))._unsafeUnwrap();
      expect(await physicalColumns(input)).toEqual([]);

      await enable(input);
      await enable(input);
      expect(await physicalColumns(input)).toHaveLength(4);
      const rows = await sql<Record<string, unknown>>`SELECT __id, __created_by, __version,
        __created_by_actor_type, __created_by_actor_id,
        __last_modified_by_actor_type, __last_modified_by_actor_id
        FROM ${input.target}`.execute(db);
      expect(rows.rows).toEqual([
        {
          __id: 'legacy-row',
          __created_by: 'native-executor',
          __version: 1,
          __created_by_actor_type: null,
          __created_by_actor_id: null,
          __last_modified_by_actor_type: null,
          __last_modified_by_actor_id: null,
        },
      ]);
      await assertPairChecks(input, 'legacy-row');
    });

    it('rejects enable without a caller data transaction without modifying the table', async () => {
      const input = fixture();
      await createLegacy(input);
      const result = await input.repository.ensureActorColumns(context, input.table);
      expect(result._unsafeUnwrapErr().message).toContain('caller data transaction');
      expect(await physicalColumns(input)).toEqual([]);
    });

    it.each(['integer', 'varchar(255)', 'text NOT NULL', "text DEFAULT 'forged'"])(
      'rejects an incompatible same-name column (%s) before adding any missing columns',
      async (definition) => {
        const input = fixture();
        await createLegacy(input);
        if (definition === 'text NOT NULL') {
          await sql`DELETE FROM ${input.target}`.execute(db);
        }
        await sql`ALTER TABLE ${input.target} ADD COLUMN __created_by_actor_type ${sql.raw(definition)}`.execute(
          db
        );
        await enable(input, {
          code: 'actor_columns.incompatible_schema',
        });
        expect((await physicalColumns(input)).map((column) => column.column_name)).toEqual([
          '__created_by_actor_type',
        ]);
      }
    );

    it.each(actorColumns)('rejects a legacy business field occupying %s', async (columnName) => {
      const input = fixture();
      await createLegacy(input);
      const field = input.table.getFields()[0]!;
      field.setDbFieldName(DbFieldName.rehydrate(columnName)._unsafeUnwrap())._unsafeUnwrap();
      await sql`ALTER TABLE ${input.target} ADD COLUMN ${sql.id(columnName)} text`.execute(db);
      await sql`UPDATE ${input.target} SET ${sql.id(columnName)} = 'business-value'`.execute(db);
      await enable(input, {
        code: 'actor_columns.business_collision',
      });
      expect(await physicalColumns(input)).toHaveLength(1);
      const values = await sql<{ value: string }>`SELECT ${sql.id(columnName)} AS value
        FROM ${input.target}`.execute(db);
      expect(values.rows).toEqual([{ value: 'business-value' }]);
    });

    it('converges from partial columns and replaces a weaker same-name check', async () => {
      const input = fixture();
      await createLegacy(input);
      await sql`ALTER TABLE ${input.target}
        ADD COLUMN __created_by_actor_type text DEFAULT NULL,
        ADD COLUMN __created_by_actor_id text,
        ADD CONSTRAINT __created_by_actor_pair_check CHECK (true)`.execute(db);
      await enable(input);
      await enable(input);
      await assertPairChecks(input, 'legacy-row');
    });

    it('rolls back added columns on caller failure and can retry', async () => {
      const input = fixture();
      await createLegacy(input);
      await expect(
        db.transaction().execute(async (trx) => {
          const result = await input.repository.ensureActorColumns(
            { ...context, transaction: new PostgresUnitOfWorkTransaction(trx as never) },
            input.table
          );
          result._unsafeUnwrap();
          throw new Error('caller rollback');
        })
      ).rejects.toThrow('caller rollback');
      expect(await physicalColumns(input)).toEqual([]);
      await enable(input);
      expect(await physicalColumns(input)).toHaveLength(4);
    });

    it('sets transaction-local DDL bounds and validates both actor checks before returning', async () => {
      const input = fixture();
      await createLegacy(input);
      await db.transaction().execute(async (trx) => {
        const result = await input.repository.ensureActorColumns(
          { ...context, transaction: new PostgresUnitOfWorkTransaction(trx as never) },
          input.table
        );
        result._unsafeUnwrap();
        const settings = await sql<{ lock_timeout: string; statement_timeout: string }>`
          SELECT current_setting('lock_timeout') AS lock_timeout,
            current_setting('statement_timeout') AS statement_timeout`.execute(trx);
        expect(settings.rows).toEqual([{ lock_timeout: '3s', statement_timeout: '30s' }]);
        const checks = await sql<{ conname: string; convalidated: boolean }>`
          SELECT c.conname, c.convalidated
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = ${input.schema ?? 'public'} AND t.relname = ${input.tableName}
            AND c.contype = 'c'
            AND c.conname IN ('__created_by_actor_pair_check', '__last_modified_by_actor_pair_check')
          ORDER BY c.conname`.execute(trx);
        expect(checks.rows).toEqual([
          { conname: '__created_by_actor_pair_check', convalidated: true },
          { conname: '__last_modified_by_actor_pair_check', convalidated: true },
        ]);
      });
    });

    it('sanitizes unexpected storage failures without exposing SQL diagnostics', async () => {
      const input = fixture();
      await db.schema
        .createSchema(input.schema ?? 'public')
        .ifNotExists()
        .execute();
      const rollback = new Error('rollback expected actor storage failure');
      await db
        .transaction()
        .execute(async (trx) => {
          const result = await input.repository.ensureActorColumns(
            { ...context, transaction: new PostgresUnitOfWorkTransaction(trx as never) },
            input.table
          );
          const error = result._unsafeUnwrapErr();
          expect(error.code).toBe('actor_columns.storage_failure');
          expect(error.tags).toContain('infrastructure');
          expect(JSON.stringify(error)).not.toContain(input.tableName);
          expect(JSON.stringify(error)).not.toContain('LOCK TABLE');
          throw rollback;
        })
        .catch((error: unknown) => {
          if (error !== rollback) throw error;
        });
    });

    it('fails validation for an existing one-sided actor pair without publishing partial DDL', async () => {
      const input = fixture();
      await createLegacy(input);
      await sql`ALTER TABLE ${input.target} ADD COLUMN __created_by_actor_type text`.execute(db);
      await sql`UPDATE ${input.target} SET __created_by_actor_type = 'user'`.execute(db);
      await enable(input, {
        code: 'actor_columns.incompatible_schema',
      });
      expect(await physicalColumns(input)).toHaveLength(1);
      await sql`UPDATE ${input.target} SET __created_by_actor_type = NULL`.execute(db);
      await enable(input);
      await assertPairChecks(input, 'legacy-row');
    });
  });

  it('rejects an empty-table import batch before creating even its valid sibling schema', async () => {
    const baseId = BaseId.generate()._unsafeUnwrap();
    const build = (expression: string) => {
      const builder = Table.builder()
        .withBaseId(baseId)
        .withName(TableName.create('Budget')._unsafeUnwrap());
      builder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .primary()
        .done();
      builder
        .field()
        .formula()
        .withName(FieldName.create('Formula')._unsafeUnwrap())
        .withExpression(FormulaExpression.create(expression)._unsafeUnwrap())
        .withResultType({
          cellValueType: CellValueType.number(),
          isMultipleCellValue: CellValueMultiplicity.single(),
        })
        .done();
      builder.view().defaultGrid().done();
      return builder.build()._unsafeUnwrap();
    };
    const valid = build('1');
    const rejected = build('ABS(ABS(ABS(1)))');
    const backfill = new FakeComputedFieldBackfillService();
    const repository = new PostgresTableSchemaRepository(
      db,
      new FakeTableRepository([valid, rejected]) as never,
      backfill,
      new FakeComputedFieldCascadeService(),
      new FakeComputedUpdatePlanner() as never,
      new FakeFieldDependencyGraph() as never,
      db,
      new Pg16TypeValidationStrategy(),
      undefined,
      {
        policyVersion: 1,
        policy: createFormulaCompileBudgetPolicy({
          ...defaultFormulaCompileBudgetLimits,
          astDepth: 2,
        }),
      }
    );
    const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
    const single = await repository.insert(context, rejected);
    expect(single._unsafeUnwrapErr().code).toBe('validation.limit.formula_compile_depth_max');
    const batch = await repository.insertMany(context, [valid, rejected], {
      optimizeForEmptyTables: true,
    });
    expect(batch._unsafeUnwrapErr().code).toBe('validation.limit.formula_compile_depth_max');
    const rows = await sql<{
      count: string;
    }>`select count(*)::text as count from information_schema.tables where table_schema = ${baseId.toString()}`.execute(
      db
    );
    expect(rows.rows[0].count).toBe('0');
    expect(backfill.calls).toEqual([]);
  });

  it('rejects a changed formula before DDL or asynchronous backfill', async () => {
    const baseId = BaseId.generate()._unsafeUnwrap();
    const builder = Table.builder()
      .withBaseId(baseId)
      .withName(TableName.create('Update budget')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .formula()
      .withName(FieldName.create('Formula')._unsafeUnwrap())
      .withExpression(FormulaExpression.create('1')._unsafeUnwrap())
      .withResultType({
        cellValueType: CellValueType.number(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      })
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();
    const backfill = new FakeComputedFieldBackfillService();
    const repository = new PostgresTableSchemaRepository(
      db,
      new FakeTableRepository([table]) as never,
      backfill,
      new FakeComputedFieldCascadeService(),
      new FakeComputedUpdatePlanner() as never,
      new FakeFieldDependencyGraph() as never,
      db,
      new Pg16TypeValidationStrategy(),
      undefined,
      {
        policyVersion: 1,
        policy: createFormulaCompileBudgetPolicy({
          ...defaultFormulaCompileBudgetLimits,
          astDepth: 2,
        }),
      }
    );
    const field = table
      .getFields()
      .find((field): field is FormulaField => field instanceof FormulaField)!;
    const spec = UpdateFormulaExpressionSpec.create(
      field.id(),
      field.expression(),
      FormulaExpression.create('ABS(ABS(ABS(1)))')._unsafeUnwrap()
    );
    const candidate = spec.mutate(table)._unsafeUnwrap();
    const result = await repository.update(
      { actorId: ActorId.create('system')._unsafeUnwrap() },
      candidate,
      spec
    );
    expect(result._unsafeUnwrapErr().code).toBe('validation.limit.formula_compile_depth_max');
    expect(backfill.calls).toEqual([]);
    expect(field.expression().toString()).toBe('1');
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

  it('discards pending computed outbox tasks only on permanent delete', async () => {
    const baseId = BaseId.generate()._unsafeUnwrap();
    const tableId = TableId.generate()._unsafeUnwrap();
    const tableName = TableName.create('Drop Target')._unsafeUnwrap();
    const fieldName = FieldName.create('Name')._unsafeUnwrap();
    const actorId = ActorId.create('system')._unsafeUnwrap();
    const context: IExecutionContext = { actorId };

    const builder = Table.builder().withBaseId(baseId).withId(tableId).withName(tableName);
    builder.field().singleLineText().withName(fieldName).done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();

    const discardCalls: Array<{ baseId: string; seedTableId: string }> = [];
    const fieldDiscardCalls: Array<{
      baseId: string;
      seedTableId: string;
      fieldIds: ReadonlyArray<string>;
    }> = [];
    const recordingOutbox = {
      discardBySeedTable: async (params: { baseId: string; seedTableId: string }) => {
        discardCalls.push(params);
        return ok({ discardedTaskIds: [], discardedDeadLetterTaskIds: [] });
      },
      discardFieldBackfills: async (params: {
        baseId: string;
        seedTableId: string;
        fieldIds: ReadonlyArray<string>;
      }) => {
        fieldDiscardCalls.push(params);
        return ok({ discardedTaskIds: [], trimmedTaskIds: [], discardedDeadLetterTaskIds: [] });
      },
    };
    const repository = new PostgresTableSchemaRepository(
      db,
      new FakeTableRepository([table]) as never,
      new FakeComputedFieldBackfillService(),
      new FakeComputedFieldCascadeService(),
      new FakeComputedUpdatePlanner() as never,
      new FakeFieldDependencyGraph() as never,
      db,
      undefined,
      recordingOutbox
    );

    (await repository.insert(context, table))._unsafeUnwrap();

    (await repository.delete(context, table, { mode: 'soft' }))._unsafeUnwrap();
    expect(discardCalls).toEqual([]);

    (await repository.delete(context, table, { mode: 'permanent' }))._unsafeUnwrap();
    expect(discardCalls).toEqual([{ baseId: baseId.toString(), seedTableId: tableId.toString() }]);
  });

  it('discards pending field-backfill work for removed fields', async () => {
    // Field removal reads table locations and marks the search vector pending,
    // and this suite does not otherwise create table_meta.
    await db.schema
      .createTable('table_meta')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('base_id', 'text')
      .addColumn('db_table_name', 'text')
      .addColumn('search_index', 'jsonb')
      .addColumn('deleted_time', 'timestamp')
      .addColumn('version', 'integer', (col) => col.defaultTo(1))
      .execute();

    const baseId = BaseId.generate()._unsafeUnwrap();
    const tableId = TableId.generate()._unsafeUnwrap();
    const tableName = TableName.create('Field Drop Target')._unsafeUnwrap();
    const actorId = ActorId.create('system')._unsafeUnwrap();
    const context: IExecutionContext = { actorId };

    const builder = Table.builder().withBaseId(baseId).withId(tableId).withName(tableName);
    builder.field().singleLineText().withName(FieldName.create('Keep')._unsafeUnwrap()).done();
    const removedFieldId = FieldId.generate()._unsafeUnwrap();
    builder
      .field()
      .singleLineText()
      .withId(removedFieldId)
      .withName(FieldName.create('Remove')._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();

    const fieldDiscardCalls: Array<{
      baseId: string;
      seedTableId: string;
      fieldIds: ReadonlyArray<string>;
    }> = [];
    const recordingOutbox = {
      discardBySeedTable: async () => ok({ discardedTaskIds: [], discardedDeadLetterTaskIds: [] }),
      discardFieldBackfills: async (params: {
        baseId: string;
        seedTableId: string;
        fieldIds: ReadonlyArray<string>;
      }) => {
        fieldDiscardCalls.push(params);
        return ok({ discardedTaskIds: [], trimmedTaskIds: [], discardedDeadLetterTaskIds: [] });
      },
    };
    const repository = new PostgresTableSchemaRepository(
      db,
      new FakeTableRepository([table]) as never,
      new FakeComputedFieldBackfillService(),
      new FakeComputedFieldCascadeService(),
      new FakeComputedUpdatePlanner() as never,
      new FakeFieldDependencyGraph() as never,
      db,
      undefined,
      recordingOutbox
    );

    (await repository.insert(context, table))._unsafeUnwrap();

    const update = table.update((mutator) => mutator.removeField(removedFieldId))._unsafeUnwrap();
    const result = await repository.update(context, update.table, update.mutateSpec);
    expect(result.isErr() ? result.error : undefined).toBeUndefined();

    expect(fieldDiscardCalls).toEqual([
      {
        baseId: baseId.toString(),
        seedTableId: tableId.toString(),
        fieldIds: [removedFieldId.toString()],
      },
    ]);
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

  it('creates a missing physical table without replaying schema on an existing one', async () => {
    const baseId = BaseId.generate()._unsafeUnwrap();
    const tableId = TableId.generate()._unsafeUnwrap();
    const tableName = TableName.create('Ensure Physical')._unsafeUnwrap();
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

    const { schema, tableName: dbTableName } = table
      .dbTableName()
      .andThen((name) => name.split({ defaultSchema: null }))
      ._unsafeUnwrap();
    const introspector = new PostgresSchemaIntrospector(db);

    (await repository.insert(context, table))._unsafeUnwrap();
    await sql
      .raw(`DROP TABLE IF EXISTS "${schema ?? 'public'}"."${dbTableName}" CASCADE`)
      .execute(db);
    expect((await introspector.tableExists(schema, dbTableName))._unsafeUnwrap()).toBe(false);

    (await repository.ensurePhysicalTable(context, table))._unsafeUnwrap();
    expect((await introspector.tableExists(schema, dbTableName))._unsafeUnwrap()).toBe(true);

    const dbFieldName = table
      .getFields()[0]!
      .dbFieldName()
      .andThen((name) => name.value())
      ._unsafeUnwrap();
    await sql`ALTER TABLE ${sql.raw(`"${schema ?? 'public'}"."${dbTableName}"`)}
      DROP COLUMN ${sql.raw(`"${dbFieldName}"`)}`.execute(db);
    expect(
      (await introspector.columnExists(schema, dbTableName, dbFieldName))._unsafeUnwrap()
    ).toBe(false);

    (await repository.ensurePhysicalTable(context, table))._unsafeUnwrap();
    expect(
      (await introspector.columnExists(schema, dbTableName, dbFieldName))._unsafeUnwrap()
    ).toBe(false);
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
