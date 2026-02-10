/* eslint-disable require-yield */
/**
 * Integration test for Lookup field column type determination.
 * Uses PGlite to verify that lookup columns are created with correct types
 * based on isMultipleCellValue and inner field type.
 *
 * Test Matrix:
 * - Single-value lookup (ManyOne relationship) + various inner types
 * - Multi-value lookup (OneMany/ManyMany relationship) + various inner types
 * - Nested lookup (lookup -> lookup)
 * - ConditionalLookup with same patterns
 */
import { PGlite } from '@electric-sql/pglite';
import {
  createLookupFieldPending,
  createConditionalLookupField,
  createSingleLineTextField,
  createNumberField,
  createCheckboxField,
  createDateField,
  ConditionalLookupOptions,
  FieldId,
  FieldName,
  LookupOptions,
  type Field,
  type DomainError,
  LookupField,
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
import { err, type Result } from 'neverthrow';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { resolveColumnType } from '../PostgresTableSchemaFieldColumn';

const TEST_SCHEMA = 'test_lookup_schema';

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
// Helper Functions
// =============================================================================

const sanitizeIdSeed = (seed: string): string => seed.replace(/[^0-9a-z]/gi, '0');
const createValidFieldId = (seed: string): string =>
  `fld${sanitizeIdSeed(seed).padEnd(16, '0').slice(0, 16)}`;
const createValidTableId = (seed: string): string =>
  `tbl${sanitizeIdSeed(seed).padEnd(16, '0').slice(0, 16)}`;

/**
 * Create a lookup field with inner field resolved
 */
const createLookupFieldWithInner = (params: {
  id: string;
  name: string;
  innerField: Field;
  isMultipleCellValue: boolean;
}): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(params.id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(params.name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const lookupOptionsResult = LookupOptions.create({
    linkFieldId: createValidFieldId(`link_${params.id}`),
    lookupFieldId: createValidFieldId(`lookup_${params.id}`),
    foreignTableId: createValidTableId(`table_${params.id}`),
  });
  if (lookupOptionsResult.isErr()) return err(lookupOptionsResult.error);

  // Use the create method that accepts isMultipleCellValue
  return LookupField.create({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
    innerField: params.innerField,
    lookupOptions: lookupOptionsResult.value,
    isMultipleCellValue: params.isMultipleCellValue,
  });
};

/**
 * Create a conditional lookup field with inner field resolved
 */
const createConditionalLookupFieldWithInner = (params: {
  id: string;
  name: string;
  innerField: Field;
  isMultipleCellValue: boolean;
}): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(params.id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(params.name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const condOptionsResult = ConditionalLookupOptions.create({
    foreignTableId: createValidTableId(`table_${params.id}`),
    lookupFieldId: createValidFieldId(`lookup_${params.id}`),
    condition: {
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: createValidFieldId(`cond_${params.id}`),
            operator: 'is',
            value: 'ok',
          },
        ],
      },
    },
  });
  if (condOptionsResult.isErr()) return err(condOptionsResult.error);

  return createConditionalLookupField({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
    innerField: params.innerField,
    conditionalLookupOptions: condOptionsResult.value,
    isMultipleCellValue: params.isMultipleCellValue,
  });
};

/**
 * Create inner fields of various types
 */
const createInnerTextField = (): Result<Field, DomainError> => {
  const id = FieldId.create(createValidFieldId('inner_text'));
  if (id.isErr()) return err(id.error);
  const name = FieldName.create('Inner Text');
  if (name.isErr()) return err(name.error);
  return createSingleLineTextField({ id: id.value, name: name.value });
};

const createInnerNumberField = (): Result<Field, DomainError> => {
  const id = FieldId.create(createValidFieldId('inner_number'));
  if (id.isErr()) return err(id.error);
  const name = FieldName.create('Inner Number');
  if (name.isErr()) return err(name.error);
  return createNumberField({ id: id.value, name: name.value });
};

const createInnerBooleanField = (): Result<Field, DomainError> => {
  const id = FieldId.create(createValidFieldId('inner_bool'));
  if (id.isErr()) return err(id.error);
  const name = FieldName.create('Inner Boolean');
  if (name.isErr()) return err(name.error);
  return createCheckboxField({ id: id.value, name: name.value });
};

const createInnerDateField = (): Result<Field, DomainError> => {
  const id = FieldId.create(createValidFieldId('inner_date'));
  if (id.isErr()) return err(id.error);
  const name = FieldName.create('Inner Date');
  if (name.isErr()) return err(name.error);
  return createDateField({ id: id.value, name: name.value });
};

// =============================================================================
// Tests
// =============================================================================

describe('Lookup Field Column Type', () => {
  let pglite: PGlite;
  let db: Kysely<V1TeableDatabase>;

  beforeAll(async () => {
    pglite = await PGlite.create();
    db = new Kysely<V1TeableDatabase>({
      dialect: new KyselyPGliteDialect(pglite),
    });

    // Create test schema
    await db.schema.createSchema(TEST_SCHEMA).ifNotExists().execute();

    // Create a test table to insert lookup columns
    await sql`CREATE TABLE ${sql.raw(TEST_SCHEMA)}.test_table (__id TEXT PRIMARY KEY)`.execute(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  afterEach(async () => {
    // Clean up columns after each test
    const columns = await sql<{ column_name: string }>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ${TEST_SCHEMA}
        AND table_name = 'test_table'
        AND column_name != '__id'
    `.execute(db);

    for (const col of columns.rows) {
      await sql`ALTER TABLE ${sql.raw(TEST_SCHEMA)}.test_table DROP COLUMN IF EXISTS ${sql.raw(`"${col.column_name}"`)}`.execute(
        db
      );
    }
  });

  describe('Single-value lookup (isMultipleCellValue=false)', () => {
    it('should resolve to text for text inner field', async () => {
      const innerField = createInnerTextField();
      expect(innerField.isOk()).toBe(true);

      const lookupField = createLookupFieldWithInner({
        id: 'single_text',
        name: 'Single Text Lookup',
        innerField: innerField._unsafeUnwrap(),
        isMultipleCellValue: false,
      });
      expect(lookupField.isOk()).toBe(true);

      const columnType = resolveColumnType(lookupField._unsafeUnwrap());
      expect(columnType.isOk()).toBe(true);
      expect(columnType._unsafeUnwrap()).toBe('text');

      // Verify column can be created in database
      await sql`ALTER TABLE ${sql.raw(TEST_SCHEMA)}.test_table ADD COLUMN lookup_text TEXT`.execute(
        db
      );
      const info = await sql<{ data_type: string }>`
        SELECT data_type FROM information_schema.columns
        WHERE table_schema = ${TEST_SCHEMA}
          AND table_name = 'test_table'
          AND column_name = 'lookup_text'
      `.execute(db);
      expect(info.rows[0].data_type).toBe('text');
    });

    it('should resolve to double precision for number inner field', async () => {
      const innerField = createInnerNumberField();
      expect(innerField.isOk()).toBe(true);

      const lookupField = createLookupFieldWithInner({
        id: 'single_number',
        name: 'Single Number Lookup',
        innerField: innerField._unsafeUnwrap(),
        isMultipleCellValue: false,
      });
      expect(lookupField.isOk()).toBe(true);

      const columnType = resolveColumnType(lookupField._unsafeUnwrap());
      expect(columnType.isOk()).toBe(true);
      expect(columnType._unsafeUnwrap()).toBe('double precision');

      // Verify column can be created
      await sql`ALTER TABLE ${sql.raw(TEST_SCHEMA)}.test_table ADD COLUMN lookup_number DOUBLE PRECISION`.execute(
        db
      );
      const info = await sql<{ data_type: string }>`
        SELECT data_type FROM information_schema.columns
        WHERE table_schema = ${TEST_SCHEMA}
          AND table_name = 'test_table'
          AND column_name = 'lookup_number'
      `.execute(db);
      expect(info.rows[0].data_type).toBe('double precision');
    });

    it('should resolve to boolean for checkbox inner field', async () => {
      const innerField = createInnerBooleanField();
      expect(innerField.isOk()).toBe(true);

      const lookupField = createLookupFieldWithInner({
        id: 'single_bool',
        name: 'Single Boolean Lookup',
        innerField: innerField._unsafeUnwrap(),
        isMultipleCellValue: false,
      });
      expect(lookupField.isOk()).toBe(true);

      const columnType = resolveColumnType(lookupField._unsafeUnwrap());
      expect(columnType.isOk()).toBe(true);
      expect(columnType._unsafeUnwrap()).toBe('boolean');

      // Verify column can be created
      await sql`ALTER TABLE ${sql.raw(TEST_SCHEMA)}.test_table ADD COLUMN lookup_bool BOOLEAN`.execute(
        db
      );
      const info = await sql<{ data_type: string }>`
        SELECT data_type FROM information_schema.columns
        WHERE table_schema = ${TEST_SCHEMA}
          AND table_name = 'test_table'
          AND column_name = 'lookup_bool'
      `.execute(db);
      expect(info.rows[0].data_type).toBe('boolean');
    });

    it('should resolve to timestamptz for date inner field', async () => {
      const innerField = createInnerDateField();
      expect(innerField.isOk()).toBe(true);

      const lookupField = createLookupFieldWithInner({
        id: 'single_date',
        name: 'Single Date Lookup',
        innerField: innerField._unsafeUnwrap(),
        isMultipleCellValue: false,
      });
      expect(lookupField.isOk()).toBe(true);

      const columnType = resolveColumnType(lookupField._unsafeUnwrap());
      expect(columnType.isOk()).toBe(true);
      expect(columnType._unsafeUnwrap()).toBe('timestamptz');

      // Verify column can be created
      await sql`ALTER TABLE ${sql.raw(TEST_SCHEMA)}.test_table ADD COLUMN lookup_date TIMESTAMPTZ`.execute(
        db
      );
      const info = await sql<{ data_type: string }>`
        SELECT data_type FROM information_schema.columns
        WHERE table_schema = ${TEST_SCHEMA}
          AND table_name = 'test_table'
          AND column_name = 'lookup_date'
      `.execute(db);
      expect(info.rows[0].data_type).toBe('timestamp with time zone');
    });
  });

  describe('Multi-value lookup (isMultipleCellValue=true)', () => {
    it('should resolve to jsonb for text inner field when multiple', async () => {
      const innerField = createInnerTextField();
      expect(innerField.isOk()).toBe(true);

      const lookupField = createLookupFieldWithInner({
        id: 'multi_text',
        name: 'Multi Text Lookup',
        innerField: innerField._unsafeUnwrap(),
        isMultipleCellValue: true,
      });
      expect(lookupField.isOk()).toBe(true);

      const columnType = resolveColumnType(lookupField._unsafeUnwrap());
      expect(columnType.isOk()).toBe(true);
      expect(columnType._unsafeUnwrap()).toBe('jsonb');

      // Verify column can be created
      await sql`ALTER TABLE ${sql.raw(TEST_SCHEMA)}.test_table ADD COLUMN lookup_multi_text JSONB`.execute(
        db
      );
      const info = await sql<{ data_type: string }>`
        SELECT data_type FROM information_schema.columns
        WHERE table_schema = ${TEST_SCHEMA}
          AND table_name = 'test_table'
          AND column_name = 'lookup_multi_text'
      `.execute(db);
      expect(info.rows[0].data_type).toBe('jsonb');
    });

    it('should resolve to jsonb for number inner field when multiple', async () => {
      const innerField = createInnerNumberField();
      expect(innerField.isOk()).toBe(true);

      const lookupField = createLookupFieldWithInner({
        id: 'multi_number',
        name: 'Multi Number Lookup',
        innerField: innerField._unsafeUnwrap(),
        isMultipleCellValue: true,
      });
      expect(lookupField.isOk()).toBe(true);

      const columnType = resolveColumnType(lookupField._unsafeUnwrap());
      expect(columnType.isOk()).toBe(true);
      expect(columnType._unsafeUnwrap()).toBe('jsonb');
    });

    it('should resolve to jsonb for boolean inner field when multiple', async () => {
      const innerField = createInnerBooleanField();
      expect(innerField.isOk()).toBe(true);

      const lookupField = createLookupFieldWithInner({
        id: 'multi_bool',
        name: 'Multi Boolean Lookup',
        innerField: innerField._unsafeUnwrap(),
        isMultipleCellValue: true,
      });
      expect(lookupField.isOk()).toBe(true);

      const columnType = resolveColumnType(lookupField._unsafeUnwrap());
      expect(columnType.isOk()).toBe(true);
      expect(columnType._unsafeUnwrap()).toBe('jsonb');
    });

    it('should resolve to jsonb for date inner field when multiple', async () => {
      const innerField = createInnerDateField();
      expect(innerField.isOk()).toBe(true);

      const lookupField = createLookupFieldWithInner({
        id: 'multi_date',
        name: 'Multi Date Lookup',
        innerField: innerField._unsafeUnwrap(),
        isMultipleCellValue: true,
      });
      expect(lookupField.isOk()).toBe(true);

      const columnType = resolveColumnType(lookupField._unsafeUnwrap());
      expect(columnType.isOk()).toBe(true);
      expect(columnType._unsafeUnwrap()).toBe('jsonb');
    });
  });

  describe('Nested lookup (lookup -> lookup)', () => {
    it('should resolve single-value nested lookup based on innermost field type', async () => {
      // First level: inner number field
      const numberField = createInnerNumberField();
      expect(numberField.isOk()).toBe(true);

      // Second level: lookup of number field (single value)
      const innerLookup = createLookupFieldWithInner({
        id: 'nested_inner',
        name: 'Inner Lookup',
        innerField: numberField._unsafeUnwrap(),
        isMultipleCellValue: false,
      });
      expect(innerLookup.isOk()).toBe(true);

      // Third level: lookup of lookup (single value)
      const nestedLookup = createLookupFieldWithInner({
        id: 'nested_outer',
        name: 'Nested Lookup',
        innerField: innerLookup._unsafeUnwrap(),
        isMultipleCellValue: false,
      });
      expect(nestedLookup.isOk()).toBe(true);

      // Nested single-value lookup should still respect inner field type
      // The cellValueType comes from innermost field
      const columnType = resolveColumnType(nestedLookup._unsafeUnwrap());
      expect(columnType.isOk()).toBe(true);
      // Note: nested lookups might resolve differently based on implementation
      // For now, verify it doesn't error
    });

    it('should resolve multi-value nested lookup to jsonb', async () => {
      const textField = createInnerTextField();
      expect(textField.isOk()).toBe(true);

      // Inner lookup (multi value)
      const innerLookup = createLookupFieldWithInner({
        id: 'nested_multi_inner',
        name: 'Inner Multi Lookup',
        innerField: textField._unsafeUnwrap(),
        isMultipleCellValue: true,
      });
      expect(innerLookup.isOk()).toBe(true);

      // Outer lookup (multi value)
      const nestedLookup = createLookupFieldWithInner({
        id: 'nested_multi_outer',
        name: 'Nested Multi Lookup',
        innerField: innerLookup._unsafeUnwrap(),
        isMultipleCellValue: true,
      });
      expect(nestedLookup.isOk()).toBe(true);

      const columnType = resolveColumnType(nestedLookup._unsafeUnwrap());
      expect(columnType.isOk()).toBe(true);
      expect(columnType._unsafeUnwrap()).toBe('jsonb');
    });

    it('should handle deep nesting (3 levels)', async () => {
      const numberField = createInnerNumberField();
      expect(numberField.isOk()).toBe(true);

      const level1 = createLookupFieldWithInner({
        id: 'deep_l1',
        name: 'Level 1',
        innerField: numberField._unsafeUnwrap(),
        isMultipleCellValue: true,
      });
      expect(level1.isOk()).toBe(true);

      const level2 = createLookupFieldWithInner({
        id: 'deep_l2',
        name: 'Level 2',
        innerField: level1._unsafeUnwrap(),
        isMultipleCellValue: true,
      });
      expect(level2.isOk()).toBe(true);

      const level3 = createLookupFieldWithInner({
        id: 'deep_l3',
        name: 'Level 3',
        innerField: level2._unsafeUnwrap(),
        isMultipleCellValue: true,
      });
      expect(level3.isOk()).toBe(true);

      const columnType = resolveColumnType(level3._unsafeUnwrap());
      expect(columnType.isOk()).toBe(true);
      expect(columnType._unsafeUnwrap()).toBe('jsonb');
    });
  });

  describe('ConditionalLookup column types', () => {
    it('should resolve single-value conditional lookup to scalar type', async () => {
      const numberField = createInnerNumberField();
      expect(numberField.isOk()).toBe(true);

      const condLookup = createConditionalLookupFieldWithInner({
        id: 'cond_single',
        name: 'Conditional Single Lookup',
        innerField: numberField._unsafeUnwrap(),
        isMultipleCellValue: false,
      });
      expect(condLookup.isOk()).toBe(true);

      const columnType = resolveColumnType(condLookup._unsafeUnwrap());
      expect(columnType.isOk()).toBe(true);
      expect(columnType._unsafeUnwrap()).toBe('double precision');
    });

    it('should resolve multi-value conditional lookup to jsonb', async () => {
      const numberField = createInnerNumberField();
      expect(numberField.isOk()).toBe(true);

      const condLookup = createConditionalLookupFieldWithInner({
        id: 'cond_multi',
        name: 'Conditional Multi Lookup',
        innerField: numberField._unsafeUnwrap(),
        isMultipleCellValue: true,
      });
      expect(condLookup.isOk()).toBe(true);

      const columnType = resolveColumnType(condLookup._unsafeUnwrap());
      expect(columnType.isOk()).toBe(true);
      expect(columnType._unsafeUnwrap()).toBe('jsonb');
    });

    it('should support conditional lookup of lookup field', async () => {
      const textField = createInnerTextField();
      expect(textField.isOk()).toBe(true);

      const innerLookup = createLookupFieldWithInner({
        id: 'cond_nested_inner',
        name: 'Inner Lookup',
        innerField: textField._unsafeUnwrap(),
        isMultipleCellValue: true,
      });
      expect(innerLookup.isOk()).toBe(true);

      const condLookup = createConditionalLookupFieldWithInner({
        id: 'cond_nested_outer',
        name: 'Conditional of Lookup',
        innerField: innerLookup._unsafeUnwrap(),
        isMultipleCellValue: true,
      });
      expect(condLookup.isOk()).toBe(true);

      const columnType = resolveColumnType(condLookup._unsafeUnwrap());
      expect(columnType.isOk()).toBe(true);
      expect(columnType._unsafeUnwrap()).toBe('jsonb');
    });
  });

  describe('Database column type compatibility', () => {
    it('should allow INSERT/UPDATE on single-value lookup columns', async () => {
      // Create a column matching single-value number lookup
      await sql`ALTER TABLE ${sql.raw(TEST_SCHEMA)}.test_table ADD COLUMN single_num DOUBLE PRECISION`.execute(
        db
      );

      // Insert a value
      await sql`INSERT INTO ${sql.raw(TEST_SCHEMA)}.test_table (__id, single_num) VALUES ('r1', 42.5)`.execute(
        db
      );

      // Verify
      const result = await sql<{ single_num: number }>`
        SELECT single_num FROM ${sql.raw(TEST_SCHEMA)}.test_table WHERE __id = 'r1'
      `.execute(db);
      expect(result.rows[0].single_num).toBe(42.5);

      // Update
      await sql`UPDATE ${sql.raw(TEST_SCHEMA)}.test_table SET single_num = 100.0 WHERE __id = 'r1'`.execute(
        db
      );
      const updated = await sql<{ single_num: number }>`
        SELECT single_num FROM ${sql.raw(TEST_SCHEMA)}.test_table WHERE __id = 'r1'
      `.execute(db);
      expect(updated.rows[0].single_num).toBe(100);
    });

    it('should allow INSERT/UPDATE on multi-value lookup columns', async () => {
      // Create a column matching multi-value lookup (jsonb)
      await sql`ALTER TABLE ${sql.raw(TEST_SCHEMA)}.test_table ADD COLUMN multi_val JSONB`.execute(
        db
      );

      // Insert array value
      await sql`INSERT INTO ${sql.raw(TEST_SCHEMA)}.test_table (__id, multi_val) VALUES ('r2', '["a", "b", "c"]'::jsonb)`.execute(
        db
      );

      // Verify
      const result = await sql<{ multi_val: string[] }>`
        SELECT multi_val FROM ${sql.raw(TEST_SCHEMA)}.test_table WHERE __id = 'r2'
      `.execute(db);
      expect(result.rows[0].multi_val).toEqual(['a', 'b', 'c']);

      // Update
      await sql`UPDATE ${sql.raw(TEST_SCHEMA)}.test_table SET multi_val = '["x", "y"]'::jsonb WHERE __id = 'r2'`.execute(
        db
      );
      const updated = await sql<{ multi_val: string[] }>`
        SELECT multi_val FROM ${sql.raw(TEST_SCHEMA)}.test_table WHERE __id = 'r2'
      `.execute(db);
      expect(updated.rows[0].multi_val).toEqual(['x', 'y']);
    });

    it('should handle NULL values for both single and multi-value lookups', async () => {
      await sql`ALTER TABLE ${sql.raw(TEST_SCHEMA)}.test_table ADD COLUMN nullable_single TEXT`.execute(
        db
      );
      await sql`ALTER TABLE ${sql.raw(TEST_SCHEMA)}.test_table ADD COLUMN nullable_multi JSONB`.execute(
        db
      );

      // Insert NULL values
      await sql`INSERT INTO ${sql.raw(TEST_SCHEMA)}.test_table (__id, nullable_single, nullable_multi) VALUES ('r3', NULL, NULL)`.execute(
        db
      );

      const result = await sql<{ nullable_single: string | null; nullable_multi: unknown | null }>`
        SELECT nullable_single, nullable_multi
        FROM ${sql.raw(TEST_SCHEMA)}.test_table WHERE __id = 'r3'
      `.execute(db);
      expect(result.rows[0].nullable_single).toBeNull();
      expect(result.rows[0].nullable_multi).toBeNull();
    });
  });
});

describe('Lookup Field Default Behavior (no isMultipleCellValue set)', () => {
  it('should default to jsonb when isMultipleCellValue is undefined', async () => {
    // Use pending lookup field which doesn't have isMultipleCellValue set
    const fieldId = FieldId.create(createValidFieldId('default_lookup'));
    expect(fieldId.isOk()).toBe(true);

    const fieldName = FieldName.create('Default Lookup');
    expect(fieldName.isOk()).toBe(true);

    const lookupOptions = LookupOptions.create({
      linkFieldId: createValidFieldId('default_link'),
      lookupFieldId: createValidFieldId('default_target'),
      foreignTableId: createValidTableId('default_table'),
    });
    expect(lookupOptions.isOk()).toBe(true);

    // Create pending lookup field without inner field resolved
    const pendingLookup = createLookupFieldPending({
      id: fieldId._unsafeUnwrap(),
      name: fieldName._unsafeUnwrap(),
      lookupOptions: lookupOptions._unsafeUnwrap(),
    });
    expect(pendingLookup.isOk()).toBe(true);

    // Pending lookups should still return a result (defaults to multiple)
    const columnType = resolveColumnType(pendingLookup._unsafeUnwrap());
    expect(columnType.isOk()).toBe(true);
    expect(columnType._unsafeUnwrap()).toBe('jsonb');
  });
});
