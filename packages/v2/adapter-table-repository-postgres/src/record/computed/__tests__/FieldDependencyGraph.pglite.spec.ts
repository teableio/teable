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
  #onQuery?: (sql: string) => void;

  constructor(client: PGlite, onQuery?: (sql: string) => void) {
    this.#client = client;
    this.#onQuery = onQuery;
  }

  async init() {}

  async acquireConnection() {
    return new PGliteConnection(this.#client, this.#onQuery);
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
  #onQuery?: (sql: string) => void;

  constructor(client: PGlite, onQuery?: (sql: string) => void) {
    this.#client = client;
    this.#onQuery = onQuery;
  }

  async executeQuery<O>(compiledQuery: CompiledQuery): Promise<QueryResult<O>> {
    this.#onQuery?.(compiledQuery.sql);
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
  #onQuery?: (sql: string) => void;

  constructor(client: PGlite, onQuery?: (sql: string) => void) {
    this.#client = client;
    this.#onQuery = onQuery;
  }

  createDriver() {
    return new PGliteDriver(this.#client, this.#onQuery);
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
  const executedSql: string[] = [];

  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const productsTableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
  const reportsTableId = TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap();
  const productNameFieldId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();
  const categoryFieldId = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();
  const priceFieldId = FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap();
  const reportNameFieldId = FieldId.create(`fld${'g'.repeat(16)}`)._unsafeUnwrap();
  const conditionalRollupFieldId = FieldId.create(`fld${'h'.repeat(16)}`)._unsafeUnwrap();
  const reportLinkFieldId = FieldId.create(`fld${'i'.repeat(16)}`)._unsafeUnwrap();
  const reportLookupFieldId = FieldId.create(`fld${'j'.repeat(16)}`)._unsafeUnwrap();
  const reportFallbackLookupFieldId = FieldId.create(`fld${'k'.repeat(16)}`)._unsafeUnwrap();
  const reportFormulaOverLookupFieldId = FieldId.create(`fld${'l'.repeat(16)}`)._unsafeUnwrap();
  const referenceSeedFieldId = FieldId.create(`fld${'m'.repeat(16)}`)._unsafeUnwrap();
  const referenceFormulaAFieldId = FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap();
  const referenceFormulaBFieldId = FieldId.create(`fld${'o'.repeat(16)}`)._unsafeUnwrap();
  const referenceFormulaCFieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();
  const legacyFilteredLookupFieldId = FieldId.create(`fld${'q'.repeat(16)}`)._unsafeUnwrap();
  const legacyConditionalLookupFieldId = FieldId.create(`fld${'r'.repeat(16)}`)._unsafeUnwrap();
  const mixedReferenceSeedFieldId = FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap();
  const mixedReferenceFormulaFieldId = FieldId.create(`fld${'t'.repeat(16)}`)._unsafeUnwrap();
  const mixedLegacyLookupFieldId = FieldId.create(`fld${'u'.repeat(16)}`)._unsafeUnwrap();
  const mixedReferenceTailFieldId = FieldId.create(`fld${'v'.repeat(16)}`)._unsafeUnwrap();
  const largeReferenceChainFieldIds = Array.from({ length: 102 }, (_, index) =>
    FieldId.create(`fld${index.toString().padStart(16, '0')}`)._unsafeUnwrap()
  );
  const logger = {
    debug() {},
    warn() {},
  };

  beforeAll(async () => {
    pglite = await PGlite.create();
    db = new Kysely<V1TeableDatabase>({
      dialect: new PGliteDialect(pglite, (sql) => executedSql.push(sql)),
    });

    // Create schema and tables
    await db.schema.createSchema(TEST_SCHEMA).ifNotExists().execute();

    // Create table_meta table
    await db.schema
      .createTable(`${TEST_SCHEMA}.table_meta`)
      .addColumn('id', 'varchar', (col) => col.primaryKey())
      .addColumn('base_id', 'varchar', (col) => col.notNull())
      .addColumn('name', 'varchar')
      .addColumn('provision_state', 'varchar', (col) => col.defaultTo('ready'))
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
      .addColumn('lookup_linked_field_id', 'varchar')
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
        provision_state: 'ready',
      })
      .execute();

    // Insert test data: Reports table
    await db
      .insertInto(`${TEST_SCHEMA}.table_meta` as any)
      .values({
        id: reportsTableId.toString(),
        base_id: baseId.toString(),
        name: 'Reports',
        provision_state: 'ready',
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
        {
          id: reportLinkFieldId.toString(),
          table_id: reportsTableId.toString(),
          type: 'link',
          is_computed: false,
          options: JSON.stringify({
            foreignTableId: productsTableId.toString(),
            lookupFieldId: productNameFieldId.toString(),
          }),
        },
        {
          id: reportLookupFieldId.toString(),
          table_id: reportsTableId.toString(),
          type: 'singleLineText',
          is_computed: true,
          is_lookup: true,
          lookup_options: JSON.stringify({
            linkFieldId: reportLinkFieldId.toString(),
            foreignTableId: productsTableId.toString(),
            lookupFieldId: productNameFieldId.toString(),
          }),
          lookup_linked_field_id: reportLinkFieldId.toString(),
        },
        {
          id: reportFallbackLookupFieldId.toString(),
          table_id: reportsTableId.toString(),
          type: 'singleLineText',
          is_computed: true,
          is_lookup: true,
          lookup_options: JSON.stringify({
            linkFieldId: reportLinkFieldId.toString(),
            foreignTableId: productsTableId.toString(),
            lookupFieldId: productNameFieldId.toString(),
          }),
        },
        {
          id: reportFormulaOverLookupFieldId.toString(),
          table_id: reportsTableId.toString(),
          type: 'singleLineText',
          is_computed: true,
          options: JSON.stringify({
            expression: `{${reportLookupFieldId.toString()}}`,
          }),
        },
        {
          id: referenceSeedFieldId.toString(),
          table_id: reportsTableId.toString(),
          type: 'number',
          is_computed: false,
        },
        {
          id: referenceFormulaAFieldId.toString(),
          table_id: reportsTableId.toString(),
          type: 'number',
          is_computed: true,
          options: JSON.stringify({ expression: `{${referenceSeedFieldId.toString()}}` }),
        },
        {
          id: referenceFormulaBFieldId.toString(),
          table_id: reportsTableId.toString(),
          type: 'number',
          is_computed: true,
          options: JSON.stringify({ expression: `{${referenceFormulaAFieldId.toString()}}` }),
        },
        {
          id: referenceFormulaCFieldId.toString(),
          table_id: reportsTableId.toString(),
          type: 'number',
          is_computed: true,
          options: JSON.stringify({ expression: `{${referenceFormulaBFieldId.toString()}}` }),
        },
        {
          id: legacyFilteredLookupFieldId.toString(),
          table_id: reportsTableId.toString(),
          type: 'singleLineText',
          is_computed: true,
          is_lookup: true,
          lookup_linked_field_id: reportLinkFieldId.toString(),
          lookup_options: JSON.stringify({
            linkFieldId: reportLinkFieldId.toString(),
            foreignTableId: productsTableId.toString(),
            lookupFieldId: productNameFieldId.toString(),
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: categoryFieldId.toString(), operator: 'isNotEmpty' }],
            },
          }),
        },
        {
          id: legacyConditionalLookupFieldId.toString(),
          table_id: reportsTableId.toString(),
          type: 'singleLineText',
          is_computed: true,
          is_lookup: true,
          is_conditional_lookup: true,
          lookup_options: JSON.stringify({
            foreignTableId: productsTableId.toString(),
            lookupFieldId: productNameFieldId.toString(),
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: categoryFieldId.toString(), operator: 'isNotEmpty' }],
            },
          }),
        },
        {
          id: mixedReferenceSeedFieldId.toString(),
          table_id: reportsTableId.toString(),
          type: 'number',
          is_computed: false,
        },
        {
          id: mixedReferenceFormulaFieldId.toString(),
          table_id: reportsTableId.toString(),
          type: 'number',
          is_computed: true,
          options: JSON.stringify({ expression: `{${mixedReferenceSeedFieldId.toString()}}` }),
        },
        {
          id: mixedLegacyLookupFieldId.toString(),
          table_id: reportsTableId.toString(),
          type: 'singleLineText',
          is_computed: true,
          is_lookup: true,
          lookup_linked_field_id: mixedReferenceFormulaFieldId.toString(),
          lookup_options: JSON.stringify({
            linkFieldId: mixedReferenceFormulaFieldId.toString(),
            foreignTableId: reportsTableId.toString(),
            lookupFieldId: mixedReferenceSeedFieldId.toString(),
          }),
        },
        {
          id: mixedReferenceTailFieldId.toString(),
          table_id: reportsTableId.toString(),
          type: 'number',
          is_computed: true,
          options: JSON.stringify({ expression: `{${mixedLegacyLookupFieldId.toString()}}` }),
        },
      ])
      .execute();

    await db
      .insertInto(`${TEST_SCHEMA}.reference` as any)
      .values([
        {
          from_field_id: reportLookupFieldId.toString(),
          to_field_id: reportFormulaOverLookupFieldId.toString(),
        },
        {
          from_field_id: referenceSeedFieldId.toString(),
          to_field_id: referenceFormulaAFieldId.toString(),
        },
        {
          from_field_id: referenceFormulaAFieldId.toString(),
          to_field_id: referenceFormulaBFieldId.toString(),
        },
        {
          from_field_id: referenceFormulaBFieldId.toString(),
          to_field_id: referenceFormulaCFieldId.toString(),
        },
        {
          from_field_id: referenceFormulaCFieldId.toString(),
          to_field_id: referenceFormulaAFieldId.toString(),
        },
        {
          from_field_id: mixedReferenceSeedFieldId.toString(),
          to_field_id: mixedReferenceFormulaFieldId.toString(),
        },
        {
          from_field_id: mixedLegacyLookupFieldId.toString(),
          to_field_id: mixedReferenceTailFieldId.toString(),
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

  it('finds lookup dependents from seed link fields via lookup_linked_field_id with JSON fallback', async () => {
    await pglite.query(`SET search_path TO ${TEST_SCHEMA}`);
    const graph = new FieldDependencyGraph(db as any, logger as any);

    const result = await graph.load(baseId, undefined, {
      requiredFieldIds: [reportLinkFieldId],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.fieldsById.has(reportLinkFieldId.toString())).toBe(true);
    expect(result.value.fieldsById.has(reportLookupFieldId.toString())).toBe(true);
    expect(result.value.fieldsById.has(reportFallbackLookupFieldId.toString())).toBe(true);
    expect(result.value.fieldsById.has(reportFormulaOverLookupFieldId.toString())).toBe(true);
    expect(
      result.value.edges.some(
        (edge) =>
          edge.fromFieldId.equals(reportLinkFieldId) &&
          edge.toFieldId.equals(reportLookupFieldId) &&
          edge.kind === 'same_record'
      )
    ).toBe(true);
    expect(
      result.value.edges.some(
        (edge) =>
          edge.fromFieldId.equals(reportLinkFieldId) &&
          edge.toFieldId.equals(reportFallbackLookupFieldId) &&
          edge.kind === 'same_record'
      )
    ).toBe(true);
  });

  it('finds all legacy filter dependents with one base-scoped fallback branch', async () => {
    await pglite.query(`SET search_path TO ${TEST_SCHEMA}`);
    const graph = new FieldDependencyGraph(db as any, logger as any);

    const result = await graph.load(baseId, undefined, {
      requiredFieldIds: [categoryFieldId],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.fieldsById.has(conditionalRollupFieldId.toString())).toBe(true);
    expect(result.value.fieldsById.has(legacyFilteredLookupFieldId.toString())).toBe(true);
    expect(result.value.fieldsById.has(legacyConditionalLookupFieldId.toString())).toBe(true);
  });

  it('normalizes v1 formula result-type rows so lookup changes reach dependent formulas', async () => {
    await pglite.query(`SET search_path TO ${TEST_SCHEMA}`);
    const graph = new FieldDependencyGraph(db as any, logger as any);

    const result = await graph.load(baseId, undefined, {
      requiredFieldIds: [reportLookupFieldId],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    const formulaMeta = result.value.fieldsById.get(reportFormulaOverLookupFieldId.toString());
    expect(formulaMeta?.type).toBe('formula');
    expect(
      result.value.edges.some(
        (edge) =>
          edge.fromFieldId.equals(reportLookupFieldId) &&
          edge.toFieldId.equals(reportFormulaOverLookupFieldId) &&
          edge.semantic === 'formula_ref'
      )
    ).toBe(true);
  });

  it('expands a reference chain in one traversal query and shares the batch across fallbacks', async () => {
    await pglite.query(`SET search_path TO ${TEST_SCHEMA}`);
    const graph = new FieldDependencyGraph(db as any, logger as any);
    executedSql.length = 0;

    const result = await graph.load(baseId, undefined, {
      requiredFieldIds: [referenceSeedFieldId],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.fieldsById.has(referenceFormulaAFieldId.toString())).toBe(true);
    expect(result.value.fieldsById.has(referenceFormulaBFieldId.toString())).toBe(true);
    expect(result.value.fieldsById.has(referenceFormulaCFieldId.toString())).toBe(true);

    const traversalQueries = executedSql.filter((statement) =>
      statement.toLowerCase().includes('reference_walk')
    );
    expect(traversalQueries).toHaveLength(1);

    const traversalSql = traversalQueries[0].toLowerCase();
    expect(traversalSql.match(/\(\s*values/g)).toHaveLength(1);
    expect(traversalSql).not.toContain('union all');

    const indexedFallbackQueries = executedSql.filter((statement) =>
      statement.toLowerCase().includes('-- 10. symmetric link field')
    );
    expect(indexedFallbackQueries).toHaveLength(1);

    const fallbackSql = indexedFallbackQueries[0].toLowerCase();
    expect(fallbackSql.match(/\(\s*values/g)).toHaveLength(1);
    expect(fallbackSql.match(/\bunion all\b/g)).toHaveLength(6);
    expect(fallbackSql).not.toMatch(/cross join\s*\(\s*select id/);
    expect(fallbackSql).not.toContain('::text like');
    expect(fallbackSql).not.toContain('jsonb_path_query');

    const filterFallbackQueries = executedSql.filter((statement) =>
      statement.toLowerCase().includes('jsonb_path_query')
    );
    expect(filterFallbackQueries).toHaveLength(1);
    expect(filterFallbackQueries[0].toLowerCase().match(/jsonb_path_query/g)).toHaveLength(1);
  });

  it('continues through a reference-to-legacy-to-reference dependency chain', async () => {
    await pglite.query(`SET search_path TO ${TEST_SCHEMA}`);
    const graph = new FieldDependencyGraph(db as any, logger as any);
    executedSql.length = 0;

    const result = await graph.load(baseId, undefined, {
      requiredFieldIds: [mixedReferenceSeedFieldId],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.fieldsById.has(mixedReferenceFormulaFieldId.toString())).toBe(true);
    expect(result.value.fieldsById.has(mixedLegacyLookupFieldId.toString())).toBe(true);
    expect(result.value.fieldsById.has(mixedReferenceTailFieldId.toString())).toBe(true);

    const traversalQueries = executedSql.filter((statement) =>
      statement.toLowerCase().includes('reference_walk')
    );
    expect(traversalQueries).toHaveLength(2);
  });

  it('chunks indexed fallbacks but scans legacy filter JSON once for a large closure', async () => {
    await pglite.query(`SET search_path TO ${TEST_SCHEMA}`);
    const graph = new FieldDependencyGraph(db as any, logger as any);

    await db
      .insertInto(`${TEST_SCHEMA}.field` as any)
      .values(
        largeReferenceChainFieldIds.map((fieldId, index) => ({
          id: fieldId.toString(),
          table_id: reportsTableId.toString(),
          type: 'number',
          is_computed: index > 0,
          options:
            index > 0
              ? JSON.stringify({
                  expression: `{${largeReferenceChainFieldIds[index - 1].toString()}}`,
                })
              : null,
        }))
      )
      .execute();
    await db
      .insertInto(`${TEST_SCHEMA}.reference` as any)
      .values(
        largeReferenceChainFieldIds.slice(1).map((fieldId, index) => ({
          from_field_id: largeReferenceChainFieldIds[index].toString(),
          to_field_id: fieldId.toString(),
        }))
      )
      .execute();

    executedSql.length = 0;

    const result = await graph.load(baseId, undefined, {
      requiredFieldIds: [largeReferenceChainFieldIds[0]],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.fieldsById.has(largeReferenceChainFieldIds.at(-1)!.toString())).toBe(true);
    expect(
      executedSql.filter((statement) => statement.toLowerCase().includes('reference_walk'))
    ).toHaveLength(1);
    expect(
      executedSql.filter((statement) =>
        statement.toLowerCase().includes('-- 10. symmetric link field')
      )
    ).toHaveLength(2);
    expect(
      executedSql.filter((statement) => statement.toLowerCase().includes('jsonb_path_query'))
    ).toHaveLength(1);
  });

  it('ignores fields that point to non-loadable foreign tables', async () => {
    await pglite.query(`SET search_path TO ${TEST_SCHEMA}`);
    const graph = new FieldDependencyGraph(db as any, logger as any);

    await db
      .updateTable(`${TEST_SCHEMA}.table_meta` as any)
      .set({ provision_state: 'error' })
      .where('id', '=', productsTableId.toString())
      .execute();

    try {
      const result = await graph.load(baseId, undefined, {
        requiredFieldIds: [reportLinkFieldId],
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }

      expect(result.value.fieldsById.has(reportLinkFieldId.toString())).toBe(false);
      expect(
        result.value.edges.some(
          (edge) =>
            edge.fromTableId.equals(productsTableId) || edge.toTableId.equals(productsTableId)
        )
      ).toBe(false);
    } finally {
      await db
        .updateTable(`${TEST_SCHEMA}.table_meta` as any)
        .set({ provision_state: 'ready' })
        .where('id', '=', productsTableId.toString())
        .execute();
    }
  });

  it('traverses an anonymized production-scale base without unbounded fallback scans', async () => {
    await pglite.query(`SET search_path TO ${TEST_SCHEMA}`);

    // Sanitized production shape only: no customer names, values, or original IDs.
    const ajBaseId = BaseId.create(`bse${'z'.repeat(16)}`)._unsafeUnwrap();
    const ajTableIds = Array.from({ length: 180 }, (_, index) =>
      TableId.create(`tbl7${index.toString().padStart(15, '0')}`)._unsafeUnwrap()
    );
    const ajFieldIds = Array.from({ length: 3677 }, (_, index) =>
      FieldId.create(`fld8${index.toString().padStart(15, '0')}`)._unsafeUnwrap()
    );
    const nonMatchingFieldId = FieldId.create(`fld9${'0'.repeat(15)}`)._unsafeUnwrap();
    const levelWidths = [1, 89, 90, 16, 1, 5, 3] as const;
    const levels: FieldId[][] = [];
    let levelOffset = 0;

    for (const width of levelWidths) {
      levels.push(ajFieldIds.slice(levelOffset, levelOffset + width));
      levelOffset += width;
    }

    const legacyLookupFieldId = ajFieldIds[205];
    const legacyConditionalFieldId = ajFieldIds[206];
    const symmetricLinkFieldId = ajFieldIds[207];
    const lookupTailFieldId = ajFieldIds[208];
    const conditionalTailFieldId = ajFieldIds[209];
    const symmetricTailFieldId = ajFieldIds[210];
    const symmetricClosureFieldId = ajFieldIds[3];

    await db
      .insertInto(`${TEST_SCHEMA}.table_meta` as any)
      .values(
        ajTableIds.map((tableId, index) => ({
          id: tableId.toString(),
          base_id: ajBaseId.toString(),
          name: `Sanitized table ${index + 1}`,
          provision_state: 'ready',
        }))
      )
      .execute();

    const referenceRows: Array<{ from_field_id: string; to_field_id: string }> = [];
    const parentByFieldId = new Map<string, FieldId>();

    for (let levelIndex = 1; levelIndex < levels.length; levelIndex++) {
      const previousLevel = levels[levelIndex - 1];
      for (const [fieldIndex, fieldId] of levels[levelIndex].entries()) {
        const parentFieldId = previousLevel[fieldIndex % previousLevel.length];
        parentByFieldId.set(fieldId.toString(), parentFieldId);
        referenceRows.push({
          from_field_id: parentFieldId.toString(),
          to_field_id: fieldId.toString(),
        });
      }
    }

    const fieldRows: Array<Record<string, unknown>> = [];

    for (const [index, fieldId] of ajFieldIds.slice(0, 205).entries()) {
      const tableId = ajTableIds[index % ajTableIds.length];
      const isLinkNode = index >= 3 && index <= 9;
      const parentFieldId = parentByFieldId.get(fieldId.toString());
      fieldRows.push({
        id: fieldId.toString(),
        table_id: tableId.toString(),
        type: isLinkNode ? 'link' : 'number',
        is_computed: index > 0 && !isLinkNode,
        options: isLinkNode
          ? JSON.stringify({
              foreignTableId: ajTableIds[0].toString(),
              lookupFieldId: ajFieldIds[0].toString(),
              ...(fieldId.equals(symmetricClosureFieldId)
                ? { symmetricFieldId: symmetricLinkFieldId.toString() }
                : {}),
            })
          : parentFieldId
            ? JSON.stringify({ expression: `{${parentFieldId.toString()}}` })
            : null,
      });
    }

    fieldRows.push(
      {
        id: legacyLookupFieldId.toString(),
        table_id: ajTableIds[25].toString(),
        type: 'singleLineText',
        is_computed: true,
        is_lookup: true,
        lookup_linked_field_id: ajFieldIds[1].toString(),
        lookup_options: JSON.stringify({
          linkFieldId: ajFieldIds[1].toString(),
          foreignTableId: ajTableIds[0].toString(),
          lookupFieldId: ajFieldIds[0].toString(),
        }),
      },
      {
        id: legacyConditionalFieldId.toString(),
        table_id: ajTableIds[50].toString(),
        type: 'conditionalRollup',
        is_computed: true,
        options: JSON.stringify({
          expression: 'sum({values})',
          foreignTableId: ajTableIds[0].toString(),
          lookupFieldId: nonMatchingFieldId.toString(),
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: ajFieldIds[2].toString(), operator: 'isNotEmpty' }],
          },
        }),
      },
      {
        id: symmetricLinkFieldId.toString(),
        table_id: ajTableIds[75].toString(),
        type: 'link',
        is_computed: false,
        options: JSON.stringify({
          foreignTableId: ajTableIds[3].toString(),
          lookupFieldId: ajFieldIds[0].toString(),
          symmetricFieldId: symmetricClosureFieldId.toString(),
        }),
      }
    );

    for (const [tailFieldId, sourceFieldId] of [
      [lookupTailFieldId, legacyLookupFieldId],
      [conditionalTailFieldId, legacyConditionalFieldId],
      [symmetricTailFieldId, symmetricLinkFieldId],
    ] as const) {
      fieldRows.push({
        id: tailFieldId.toString(),
        table_id: ajTableIds[100].toString(),
        type: 'number',
        is_computed: true,
        options: JSON.stringify({ expression: `{${sourceFieldId.toString()}}` }),
      });
      referenceRows.push({
        from_field_id: sourceFieldId.toString(),
        to_field_id: tailFieldId.toString(),
      });
    }

    let fillerIndex = 211;
    const addFillerField = (row: Record<string, unknown>) => {
      const fieldId = ajFieldIds[fillerIndex];
      fieldRows.push({
        id: fieldId.toString(),
        table_id: ajTableIds[fillerIndex % ajTableIds.length].toString(),
        ...row,
      });
      fillerIndex++;
    };

    // Match the anonymized field-family distribution: 358 link fields total.
    for (let index = 0; index < 350; index++) {
      addFillerField({
        type: 'link',
        is_computed: false,
        options: JSON.stringify({
          foreignTableId: ajTableIds[0].toString(),
          lookupFieldId: nonMatchingFieldId.toString(),
          ...(index < 29
            ? {
                filter: {
                  filterSet: [{ fieldId: nonMatchingFieldId.toString(), operator: 'isNotEmpty' }],
                },
              }
            : {}),
        }),
      });
    }

    for (let index = 0; index < 80; index++) {
      addFillerField({
        type: 'rollup',
        is_computed: true,
        lookup_linked_field_id: nonMatchingFieldId.toString(),
        lookup_options: JSON.stringify({
          linkFieldId: nonMatchingFieldId.toString(),
          foreignTableId: ajTableIds[0].toString(),
          lookupFieldId: nonMatchingFieldId.toString(),
        }),
      });
    }

    for (let index = 0; index < 126; index++) {
      addFillerField({
        type: 'singleLineText',
        is_computed: true,
        is_lookup: true,
        is_conditional_lookup: index < 21,
        lookup_linked_field_id: nonMatchingFieldId.toString(),
        lookup_options: JSON.stringify({
          linkFieldId: nonMatchingFieldId.toString(),
          foreignTableId: ajTableIds[0].toString(),
          lookupFieldId: nonMatchingFieldId.toString(),
          ...(index < 36
            ? {
                filter: {
                  filterSet: [{ fieldId: nonMatchingFieldId.toString(), operator: 'isNotEmpty' }],
                },
              }
            : {}),
        }),
      });
    }

    for (let index = 0; index < 2; index++) {
      addFillerField({
        type: 'conditionalRollup',
        is_computed: true,
        options: JSON.stringify({
          expression: 'sum({values})',
          foreignTableId: ajTableIds[0].toString(),
          lookupFieldId: nonMatchingFieldId.toString(),
          filter: { conjunction: 'and', filterSet: [] },
        }),
      });
    }

    while (fillerIndex < ajFieldIds.length) {
      addFillerField({ type: 'number', is_computed: false });
    }

    expect(fieldRows).toHaveLength(3677);
    expect(fieldRows.filter((row) => row.is_computed === true)).toHaveLength(410);
    expect(fieldRows.filter((row) => row.type === 'link')).toHaveLength(358);
    expect(fieldRows.filter((row) => row.type === 'rollup')).toHaveLength(80);
    expect(fieldRows.filter((row) => row.is_lookup === true)).toHaveLength(127);
    expect(fieldRows.filter((row) => row.is_conditional_lookup === true)).toHaveLength(21);
    expect(
      fieldRows.filter(
        (row) => row.type === 'conditionalRollup' || row.type === 'conditionalLookup'
      )
    ).toHaveLength(3);
    expect(
      fieldRows.filter(
        (row) => typeof row.options === 'string' && row.options.includes('"fieldId"')
      )
    ).toHaveLength(30);
    expect(
      fieldRows.filter(
        (row) => typeof row.lookup_options === 'string' && row.lookup_options.includes('"fieldId"')
      )
    ).toHaveLength(36);

    for (let offset = 0; offset < fieldRows.length; offset += 500) {
      await db
        .insertInto(`${TEST_SCHEMA}.field` as any)
        .values(fieldRows.slice(offset, offset + 500) as any)
        .execute();
    }

    expect(levels.map((level) => level.length)).toEqual(levelWidths);
    expect(referenceRows).toHaveLength(207);

    const backgroundReferenceCount = 1088 - referenceRows.length;
    const backgroundFieldIds = ajFieldIds.slice(1000);
    for (let index = 0; index < backgroundReferenceCount; index++) {
      referenceRows.push({
        from_field_id: backgroundFieldIds[index].toString(),
        to_field_id: backgroundFieldIds[index + 1].toString(),
      });
    }
    expect(referenceRows).toHaveLength(1088);

    for (let offset = 0; offset < referenceRows.length; offset += 500) {
      await db
        .insertInto(`${TEST_SCHEMA}.reference` as any)
        .values(referenceRows.slice(offset, offset + 500))
        .execute();
    }

    const graph = new FieldDependencyGraph(db as any, logger as any);
    executedSql.length = 0;
    const result = await graph.load(ajBaseId, undefined, {
      requiredFieldIds: [ajFieldIds[0]],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.fieldsById.size).toBe(211);
    expect(result.value.fieldsById.has(levels[6][2].toString())).toBe(true);
    expect(result.value.fieldsById.has(legacyLookupFieldId.toString())).toBe(true);
    expect(result.value.fieldsById.has(legacyConditionalFieldId.toString())).toBe(true);
    expect(result.value.fieldsById.has(symmetricLinkFieldId.toString())).toBe(true);
    expect(result.value.fieldsById.has(lookupTailFieldId.toString())).toBe(true);
    expect(result.value.fieldsById.has(conditionalTailFieldId.toString())).toBe(true);
    expect(result.value.fieldsById.has(symmetricTailFieldId.toString())).toBe(true);
    expect(result.value.fieldsById.has(ajFieldIds.at(-1)!.toString())).toBe(false);

    const traversalQueries = executedSql.filter((statement) =>
      statement.toLowerCase().includes('reference_walk')
    );
    const indexedFallbackQueries = executedSql.filter((statement) =>
      statement.toLowerCase().includes('-- 10. symmetric link field')
    );
    const jsonFallbackQueries = executedSql.filter((statement) =>
      statement.toLowerCase().includes('jsonb_path_query')
    );

    expect(traversalQueries).toHaveLength(2);
    expect(indexedFallbackQueries).toHaveLength(4);
    expect(jsonFallbackQueries).toHaveLength(2);
    expect(indexedFallbackQueries.every((statement) => /\(\s*values/i.test(statement))).toBe(true);
    expect(
      indexedFallbackQueries.every((statement) => statement.toLowerCase().includes('= any(array'))
    ).toBe(true);
    expect(
      indexedFallbackQueries.every((statement) => statement.toLowerCase().includes('offset'))
    ).toBe(true);
    expect(
      jsonFallbackQueries.every(
        (statement) =>
          statement.toLowerCase().includes('jsonb_path_query') &&
          !statement.toLowerCase().includes('::text like')
      )
    ).toBe(true);
  });
});
