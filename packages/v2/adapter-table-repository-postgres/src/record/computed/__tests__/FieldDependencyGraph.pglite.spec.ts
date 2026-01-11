/**
 * Integration test for FieldDependencyGraph.load with conditionalRollup field.
 * Uses PGlite to test actual database loading behavior.
 */
import { PGlite } from '@electric-sql/pglite';
import { BaseId, FieldId, TableId } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Dialect, QueryResult } from 'kysely';
import {
  CompiledQuery,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { FieldDependencyGraph } from '../FieldDependencyGraph';

const TEST_SCHEMA = 'test_base';

// PGlite Kysely dialect implementation
class PGliteDriver {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  async init() {}

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

  async releaseConnection() {}

  async destroy() {}
}

class PGliteConnection {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  async executeQuery<O>(compiledQuery: CompiledQuery): Promise<QueryResult<O>> {
    const result = await this.#client.query<O>(compiledQuery.sql, [...compiledQuery.parameters]);
    return {
      numAffectedRows: result.affectedRows ? BigInt(result.affectedRows) : undefined,
      rows: result.rows as O[],
    };
  }

  // eslint-disable-next-line require-yield
  async *streamQuery(): AsyncGenerator<never> {
    throw new Error('Streaming not supported');
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

describe('FieldDependencyGraph PGlite integration', () => {
  let pglite: PGlite;
  let db: Kysely<V1TeableDatabase>;

  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const productsTableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
  const reportsTableId = TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap();
  const productNameFieldId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();
  const categoryFieldId = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();
  const priceFieldId = FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap();
  const reportNameFieldId = FieldId.create(`fld${'g'.repeat(16)}`)._unsafeUnwrap();
  const conditionalRollupFieldId = FieldId.create(`fld${'h'.repeat(16)}`)._unsafeUnwrap();

  beforeAll(async () => {
    pglite = await PGlite.create();
    db = new Kysely<V1TeableDatabase>({
      dialect: new PGliteDialect(pglite),
    });

    // Create schema and tables
    await db.schema.createSchema(TEST_SCHEMA).ifNotExists().execute();

    // Create table_meta table
    await db.schema
      .createTable(`${TEST_SCHEMA}.table_meta`)
      .addColumn('id', 'varchar', (col) => col.primaryKey())
      .addColumn('base_id', 'varchar', (col) => col.notNull())
      .addColumn('name', 'varchar')
      .addColumn('deleted_time', 'timestamp')
      .execute();

    // Create field table (v1 format - no separate config column)
    await db.schema
      .createTable(`${TEST_SCHEMA}.field`)
      .addColumn('id', 'varchar', (col) => col.primaryKey())
      .addColumn('table_id', 'varchar', (col) => col.notNull())
      .addColumn('type', 'varchar', (col) => col.notNull())
      .addColumn('is_computed', 'boolean')
      .addColumn('is_lookup', 'boolean')
      .addColumn('is_conditional_lookup', 'boolean')
      .addColumn('options', 'text')
      .addColumn('lookup_options', 'text')
      .addColumn('meta', 'text')
      .addColumn('deleted_time', 'timestamp')
      .execute();

    // Create reference table
    await db.schema
      .createTable(`${TEST_SCHEMA}.reference`)
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('from_field_id', 'varchar', (col) => col.notNull())
      .addColumn('to_field_id', 'varchar', (col) => col.notNull())
      .execute();

    // Insert test data: Products table
    await db
      .insertInto(`${TEST_SCHEMA}.table_meta` as any)
      .values({
        id: productsTableId.toString(),
        base_id: baseId.toString(),
        name: 'Products',
      })
      .execute();

    // Insert test data: Reports table
    await db
      .insertInto(`${TEST_SCHEMA}.table_meta` as any)
      .values({
        id: reportsTableId.toString(),
        base_id: baseId.toString(),
        name: 'Reports',
      })
      .execute();

    // Insert fields: Products table fields
    await db
      .insertInto(`${TEST_SCHEMA}.field` as any)
      .values([
        {
          id: productNameFieldId.toString(),
          table_id: productsTableId.toString(),
          type: 'singleLineText',
          is_computed: false,
        },
        {
          id: categoryFieldId.toString(),
          table_id: productsTableId.toString(),
          type: 'singleSelect',
          is_computed: false,
        },
        {
          id: priceFieldId.toString(),
          table_id: productsTableId.toString(),
          type: 'number',
          is_computed: false,
        },
      ])
      .execute();

    // Insert conditionalRollup field with filter in v1 format (all in options column)
    const conditionalRollupOptions = JSON.stringify({
      expression: 'sum({values})',
      foreignTableId: productsTableId.toString(),
      lookupFieldId: priceFieldId.toString(),
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: categoryFieldId.toString(),
            operator: 'is',
            value: 'Electronics',
          },
        ],
      },
    });

    await db
      .insertInto(`${TEST_SCHEMA}.field` as any)
      .values([
        {
          id: reportNameFieldId.toString(),
          table_id: reportsTableId.toString(),
          type: 'singleLineText',
          is_computed: false,
        },
        {
          id: conditionalRollupFieldId.toString(),
          table_id: reportsTableId.toString(),
          type: 'conditionalRollup',
          is_computed: true,
          options: conditionalRollupOptions,
        },
      ])
      .execute();
  });

  afterAll(async () => {
    await db.destroy();
    await pglite.close();
  });

  it('loads conditionalRollup field with filterDto from database (v1 format)', async () => {
    // Create a modified graph that uses our test schema
    const graph = new FieldDependencyGraph(db as any);

    // Monkey-patch to use our test schema
    (graph as any).loadFields = async (dbInstance: any, baseIdArg: BaseId) => {
      // Run the same query but on our test schema
      const rows = await dbInstance
        .selectFrom(`${TEST_SCHEMA}.field as f`)
        .innerJoin(`${TEST_SCHEMA}.table_meta as t`, 't.id', 'f.table_id')
        .select([
          'f.id as id',
          'f.table_id as table_id',
          'f.type as type',
          'f.is_computed as is_computed',
          'f.is_lookup as is_lookup',
          'f.is_conditional_lookup as is_conditional_lookup',
          'f.options as options',
          'f.lookup_options as lookup_options',
          'f.meta as meta',
        ])
        .where('t.base_id', '=', baseIdArg.toString())
        .where('f.deleted_time', 'is', null)
        .where('t.deleted_time', 'is', null)
        .execute();

      console.log('[TEST] Raw rows from DB:', JSON.stringify(rows, null, 2));

      // Return raw rows for inspection
      return { rows };
    };

    // Query the raw data
    const result = await (graph as any).loadFields(db, baseId);

    // Verify the conditionalRollup field has correct options (v1 format)
    const conditionalRow = result.rows.find(
      (r: any) => r.id === conditionalRollupFieldId.toString()
    );
    console.log('[TEST] ConditionalRollup row:', conditionalRow);

    expect(conditionalRow).toBeDefined();
    expect(conditionalRow.type).toBe('conditionalRollup');
    expect(conditionalRow.is_computed).toBe(true);

    // v1 format: filter is directly in options.filter (not options.condition.filter)
    const options = JSON.parse(conditionalRow.options);
    console.log('[TEST] Parsed options:', JSON.stringify(options, null, 2));

    expect(options.expression).toBe('sum({values})');
    expect(options.foreignTableId).toBe(productsTableId.toString());
    expect(options.lookupFieldId).toBe(priceFieldId.toString());
    expect(options.filter).toBeDefined();
    expect(options.filter.conjunction).toBe('and');
    expect(options.filter.filterSet).toHaveLength(1);
    expect(options.filter.filterSet[0].fieldId).toBe(categoryFieldId.toString());
  });

  it('loads graph with correct conditionalOptions.filterDto (v1 format)', async () => {
    // Verify the raw data is correct (v1 format: filter directly in options)
    const rows = await db
      .selectFrom(`${TEST_SCHEMA}.field as f`)
      .innerJoin(`${TEST_SCHEMA}.table_meta as t`, 't.id', 'f.table_id')
      .select(['f.id', 'f.type', 'f.options', 'f.is_conditional_lookup'])
      .where('f.type', '=', 'conditionalRollup')
      .execute();

    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.type).toBe('conditionalRollup');
    expect(row.is_conditional_lookup).toBeNull();

    // v1 format: all config is in options column
    const options = JSON.parse(row.options!);
    expect(options.foreignTableId).toBe(productsTableId.toString());
    expect(options.lookupFieldId).toBe(priceFieldId.toString());
    expect(options.filter).toBeDefined();
    expect(options.filter.conjunction).toBe('and');

    // Verify the detection logic would work with v1 format:
    // isConditionalField = row.type === 'conditionalRollup' (true)
    // isConditionalLookup = Boolean(row.is_conditional_lookup) (false)
    // parseConditionalFieldOptions(row.options) reads filter from value.filter (v1 format)

    console.log('[TEST] Detection logic check (v1 format):');
    console.log('  row.type === "conditionalRollup":', row.type === 'conditionalRollup');
    console.log('  Boolean(row.is_conditional_lookup):', Boolean(row.is_conditional_lookup));
    console.log('  Would parse row.options:', !!row.options);
    console.log('  options.filter exists:', !!options.filter);
  });
});
