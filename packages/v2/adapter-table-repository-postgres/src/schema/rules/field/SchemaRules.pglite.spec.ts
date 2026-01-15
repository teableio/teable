/* eslint-disable @typescript-eslint/no-empty-function */
/**
 * Unit tests for Schema Rules using PGlite.
 *
 * These tests verify that:
 * 1. up() creates the expected schema elements and isValid() returns true
 * 2. down() removes the schema elements and isValid() returns false (for most rules)
 */
import { PGlite } from '@electric-sql/pglite';
import type { DomainError, Field, LinkField } from '@teable/v2-core';
import {
  BaseId,
  createSingleLineTextField,
  createConditionalLookupFieldPending,
  createLookupFieldPending,
  ConditionalLookupOptions,
  DbFieldName,
  DbTableName,
  FieldId,
  FieldName,
  FieldNotNull,
  FieldUnique,
  LookupOptions,
  Table,
  TableId,
  TableName,
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
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createSchemaChecker } from '../checker/SchemaChecker';
import type { SchemaCheckResult } from '../checker/SchemaCheckResult';
import { PostgresSchemaIntrospector } from '../context/PostgresSchemaIntrospector';
import type { SchemaIntrospector } from '../context/SchemaIntrospector';
import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import { ColumnExistsRule } from './ColumnExistsRule';
import { ColumnUniqueConstraintRule } from './ColumnUniqueConstraintRule';
import { FieldMetaRule } from './FieldMetaRule';
import { FkColumnRule } from './FkColumnRule';
import { ForeignKeyRule } from './ForeignKeyRule';
import { GeneratedColumnRule } from './GeneratedColumnRule';
import { IndexRule } from './IndexRule';
import type { JunctionTableConfig } from './JunctionTableRule';
import {
  JunctionTableExistsRule,
  JunctionTableForeignKeyRule,
  JunctionTableIndexRule,
  JunctionTableUniqueConstraintRule,
} from './JunctionTableRule';
import { LinkValueColumnRule } from './LinkValueColumnRule';
import { NotNullConstraintRule } from './NotNullConstraintRule';
import { OrderColumnRule } from './OrderColumnRule';
import { ReferenceRule } from './ReferenceRule';
import { UniqueIndexRule } from './UniqueIndexRule';

const TEST_SCHEMA = 'test_schema';

// PGlite Kysely dialect implementation
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async releaseConnection(_connection: PGliteConnection) {}
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

  // eslint-disable-next-line require-yield
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

/**
 * Create a valid field ID (format: fld + 16 chars)
 */
// eslint-disable-next-line regexp/use-ignore-case
const sanitizeIdSeed = (seed: string): string => seed.replace(/[^0-9a-zA-Z]/g, '0');
const createValidFieldId = (seed: string): string =>
  `fld${sanitizeIdSeed(seed).padEnd(16, '0').slice(0, 16)}`;
const createValidTableId = (seed: string): string =>
  `tbl${sanitizeIdSeed(seed).padEnd(16, '0').slice(0, 16)}`;

/**
 * Helper to create a real field with dbFieldName set
 */
const createRealField = (
  id: string,
  name: string,
  dbFieldName: string,
  options: { notNull?: boolean; unique?: boolean } = {}
): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const dbFieldResult = DbFieldName.rehydrate(dbFieldName);
  if (dbFieldResult.isErr()) return err(dbFieldResult.error);

  const notNull = options.notNull ? FieldNotNull.required() : FieldNotNull.optional();
  const unique = options.unique ? FieldUnique.enabled() : FieldUnique.disabled();

  const fieldResult = createSingleLineTextField({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
    notNull,
    unique,
  });

  if (fieldResult.isErr()) return err(fieldResult.error);

  const setResult = fieldResult.value.setDbFieldName(dbFieldResult.value);
  if (setResult.isErr()) return err(setResult.error);

  return fieldResult;
};

const createLookupField = (
  id: string,
  name: string,
  dbFieldName: string
): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const lookupOptionsResult = LookupOptions.create({
    linkFieldId: createValidFieldId(`link_${id}`),
    lookupFieldId: createValidFieldId(`lookup_${id}`),
    foreignTableId: createValidTableId(`table_${id}`),
  });
  if (lookupOptionsResult.isErr()) return err(lookupOptionsResult.error);

  const fieldResult = createLookupFieldPending({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
    lookupOptions: lookupOptionsResult.value,
  });
  if (fieldResult.isErr()) return err(fieldResult.error);

  const dbFieldResult = DbFieldName.rehydrate(dbFieldName);
  if (dbFieldResult.isErr()) return err(dbFieldResult.error);

  const setResult = fieldResult.value.setDbFieldName(dbFieldResult.value);
  if (setResult.isErr()) return err(setResult.error);

  return fieldResult;
};

const createConditionalLookupField = (
  id: string,
  name: string,
  dbFieldName: string
): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const lookupOptionsResult = ConditionalLookupOptions.create({
    foreignTableId: createValidTableId(`table_${id}`),
    lookupFieldId: createValidFieldId(`lookup_${id}`),
    condition: {
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: createValidFieldId(`cond_${id}`),
            operator: 'is',
            value: 'ok',
          },
        ],
      },
    },
  });
  if (lookupOptionsResult.isErr()) return err(lookupOptionsResult.error);

  const fieldResult = createConditionalLookupFieldPending({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
    conditionalLookupOptions: lookupOptionsResult.value,
  });
  if (fieldResult.isErr()) return err(fieldResult.error);

  const dbFieldResult = DbFieldName.rehydrate(dbFieldName);
  if (dbFieldResult.isErr()) return err(dbFieldResult.error);

  const setResult = fieldResult.value.setDbFieldName(dbFieldResult.value);
  if (setResult.isErr()) return err(setResult.error);

  return fieldResult;
};

/**
 * Create a mock LinkField for junction table tests.
 */
const createMockLinkField = (id: string, name: string): LinkField => {
  return {
    id: () => ({ toString: () => createValidFieldId(id) }),
    name: () => ({ toString: () => name }),
    relationship: () => ({ toString: () => 'manyMany' }),
    isOneWay: () => false,
  } as unknown as LinkField;
};

describe('Schema Rules Unit Tests with PGlite', () => {
  let pglite: PGlite;
  let db: Kysely<V1TeableDatabase>;
  let introspector: SchemaIntrospector;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.waitReady;

    db = new Kysely<V1TeableDatabase>({
      dialect: new KyselyPGliteDialect(pglite),
    });

    introspector = new PostgresSchemaIntrospector(db);

    // Create test schema
    await sql`CREATE SCHEMA IF NOT EXISTS ${sql.id(TEST_SCHEMA)}`.execute(db);

    // Create field and reference tables for FieldMetaRule and ReferenceRule tests
    await sql`CREATE TABLE IF NOT EXISTS field (
      id TEXT PRIMARY KEY,
      name TEXT,
      meta JSONB
    )`.execute(db);

    await sql`CREATE TABLE IF NOT EXISTS reference (
      id TEXT PRIMARY KEY,
      to_field_id TEXT NOT NULL,
      from_field_id TEXT NOT NULL,
      UNIQUE(to_field_id, from_field_id)
    )`.execute(db);
  });

  afterAll(async () => {
    await sql`DROP SCHEMA IF EXISTS ${sql.id(TEST_SCHEMA)} CASCADE`.execute(db);
    await sql`DROP TABLE IF EXISTS field CASCADE`.execute(db);
    await sql`DROP TABLE IF EXISTS reference CASCADE`.execute(db);
    await db.destroy();
  });

  afterEach(async () => {
    // Drop all tables in test schema after each test
    const result = await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = ${TEST_SCHEMA}
    `.execute(db);

    for (const row of result.rows) {
      await sql`DROP TABLE IF EXISTS ${sql.id(TEST_SCHEMA)}.${sql.id(row.table_name)} CASCADE`.execute(
        db
      );
    }
  });

  const createTestTable = async (tableName: string, columns: string[] = []) => {
    let query = `CREATE TABLE ${TEST_SCHEMA}.${tableName} (__id TEXT PRIMARY KEY`;
    for (const col of columns) {
      query += `, ${col}`;
    }
    query += ')';
    await sql.raw(query).execute(db);
  };

  const createContext = (tableName: string, field: Field): SchemaRuleContext => ({
    db,
    introspector,
    schema: TEST_SCHEMA,
    tableName,
    tableId: tableName,
    field,
  });

  const createTableAggregate = (tableName: string, field: Field): Table => {
    const tableIdResult = TableId.create(createValidTableId(`table_${tableName}`));
    if (tableIdResult.isErr()) {
      throw new Error(tableIdResult.error.message);
    }

    const baseIdResult = BaseId.create(`base_${tableName}`);
    if (baseIdResult.isErr()) {
      throw new Error(baseIdResult.error.message);
    }

    const tableNameResult = TableName.create(tableName);
    if (tableNameResult.isErr()) {
      throw new Error(tableNameResult.error.message);
    }

    const dbTableNameResult = DbTableName.rehydrate(`${TEST_SCHEMA}.${tableName}`);
    if (dbTableNameResult.isErr()) {
      throw new Error(dbTableNameResult.error.message);
    }

    const tableResult = Table.rehydrate({
      id: tableIdResult.value,
      baseId: baseIdResult.value,
      name: tableNameResult.value,
      fields: [field],
      views: [],
      primaryFieldId: field.id(),
      dbTableName: dbTableNameResult.value,
    });

    if (tableResult.isErr()) {
      throw new Error(tableResult.error.message);
    }

    return tableResult.value;
  };

  const collectFinalResults = async (
    generator: AsyncGenerator<SchemaCheckResult, void, unknown>
  ): Promise<SchemaCheckResult[]> => {
    const results: SchemaCheckResult[] = [];
    for await (const result of generator) {
      if (result.status === 'running' || result.status === 'pending') {
        continue;
      }
      results.push(result);
    }
    return results;
  };

  describe('ColumnExistsRule', () => {
    const TABLE_NAME = 'test_column_rule';

    it('should return invalid when column does not exist', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('col001', 'Name', 'name_col');
      expect(fieldResult.isOk()).toBe(true);
      const field = fieldResult._unsafeUnwrap();

      const rule = new ColumnExistsRule(field);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().missing?.length).toBeGreaterThan(0);
    });

    it('should create column with up() and validate it exists', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('col002', 'Name', 'name_col');
      expect(fieldResult.isOk()).toBe(true);
      const field = fieldResult._unsafeUnwrap();

      const rule = new ColumnExistsRule(field);
      const ctx = createContext(TABLE_NAME, field);

      // Before up: should be invalid
      const beforeResult = await rule.isValid(ctx);
      expect(beforeResult._unsafeUnwrap().valid).toBe(false);

      // Execute up
      const upResult = rule.up(ctx);
      expect(upResult.isOk()).toBe(true);
      for (const stmt of upResult._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      // After up: should be valid
      const afterResult = await rule.isValid(ctx);
      expect(afterResult._unsafeUnwrap().valid).toBe(true);
    });

    it('should drop column with down() and validate it no longer exists', async () => {
      await createTestTable(TABLE_NAME, ['name_col TEXT']);

      const fieldResult = createRealField('col003', 'Name', 'name_col');
      expect(fieldResult.isOk()).toBe(true);
      const field = fieldResult._unsafeUnwrap();

      const rule = new ColumnExistsRule(field);
      const ctx = createContext(TABLE_NAME, field);

      // Before down: should be valid
      const beforeResult = await rule.isValid(ctx);
      expect(beforeResult._unsafeUnwrap().valid).toBe(true);

      // Execute down
      const downResult = rule.down(ctx);
      expect(downResult.isOk()).toBe(true);
      for (const stmt of downResult._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      // After down: should be invalid
      const afterResult = await rule.isValid(ctx);
      expect(afterResult._unsafeUnwrap().valid).toBe(false);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('col004', 'Name', 'name_col');
      const field = fieldResult._unsafeUnwrap();
      const rule = new ColumnExistsRule(field);
      const ctx = createContext(TABLE_NAME, field);

      // Initial state: invalid
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      // up
      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      // down
      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });

    it.each([
      {
        label: 'lookup',
        factory: () => createLookupField('lookup001', 'ParentName', 'parent_name'),
      },
      {
        label: 'conditionalLookup',
        factory: () =>
          createConditionalLookupField('clookup001', 'FilteredParentName', 'parent_name'),
      },
    ])('creates $label column as jsonb', async ({ factory }) => {
      await createTestTable(TABLE_NAME);

      const fieldResult = factory();
      if (fieldResult.isErr()) {
        throw new Error(`Failed to create field: ${fieldResult.error.message}`);
      }
      const field = fieldResult._unsafeUnwrap();

      const rule = new ColumnExistsRule(field);
      const ctx = createContext(TABLE_NAME, field);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      const columnResult = await introspector.getColumn(TEST_SCHEMA, TABLE_NAME, 'parent_name');
      expect(columnResult.isOk()).toBe(true);
      expect(columnResult._unsafeUnwrap()?.dataType).toBe('jsonb');
    });
  });

  describe('ColumnUniqueConstraintRule', () => {
    const TABLE_NAME = 'test_unique_constraint_rule';

    it('should return invalid when unique index does not exist', async () => {
      await createTestTable(TABLE_NAME, ['email_col TEXT']);

      const fieldResult = createRealField('uniq001', 'Email', 'email_col', { unique: true });
      expect(fieldResult.isOk()).toBe(true);
      const field = fieldResult._unsafeUnwrap();

      const columnRule = new ColumnExistsRule(field);
      const rule = new ColumnUniqueConstraintRule(field, columnRule);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('should create unique index with up() and validate it exists', async () => {
      await createTestTable(TABLE_NAME, ['email_col TEXT']);

      const fieldResult = createRealField('uniq002', 'Email', 'email_col', { unique: true });
      const field = fieldResult._unsafeUnwrap();

      const columnRule = new ColumnExistsRule(field);
      const rule = new ColumnUniqueConstraintRule(field, columnRule);
      const ctx = createContext(TABLE_NAME, field);

      // Before up: should be invalid
      const beforeResult = await rule.isValid(ctx);
      expect(beforeResult._unsafeUnwrap().valid).toBe(false);

      // Execute up
      const upResult = rule.up(ctx);
      expect(upResult.isOk()).toBe(true);
      for (const stmt of upResult._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      // After up: should be valid
      const afterResult = await rule.isValid(ctx);
      expect(afterResult._unsafeUnwrap().valid).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TABLE_NAME, ['email_col TEXT']);

      const fieldResult = createRealField('uniq003', 'Email', 'email_col', { unique: true });
      const field = fieldResult._unsafeUnwrap();

      const columnRule = new ColumnExistsRule(field);
      const rule = new ColumnUniqueConstraintRule(field, columnRule);
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('NotNullConstraintRule', () => {
    const TABLE_NAME = 'test_not_null_rule';

    it('should detect missing NOT NULL constraint', async () => {
      await createTestTable(TABLE_NAME, ['name_col TEXT']);

      const fieldResult = createRealField('nn001', 'Name', 'name_col', { notNull: true });
      const field = fieldResult._unsafeUnwrap();

      const columnRule = new ColumnExistsRule(field);
      const rule = new NotNullConstraintRule(field, columnRule);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().missing?.some((m) => m.includes('NOT NULL'))).toBe(true);
    });

    it('should return valid when NOT NULL constraint exists', async () => {
      await createTestTable(TABLE_NAME, ['name_col TEXT NOT NULL']);

      const fieldResult = createRealField('nn002', 'Name', 'name_col', { notNull: true });
      const field = fieldResult._unsafeUnwrap();

      const columnRule = new ColumnExistsRule(field);
      const rule = new NotNullConstraintRule(field, columnRule);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TABLE_NAME, ["name_col TEXT DEFAULT ''"]);

      const fieldResult = createRealField('nn003', 'Name', 'name_col', { notNull: true });
      const field = fieldResult._unsafeUnwrap();

      const columnRule = new ColumnExistsRule(field);
      const rule = new NotNullConstraintRule(field, columnRule);
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('FkColumnRule', () => {
    const TABLE_NAME = 'test_fk_column_rule';

    it('should return invalid when FK column does not exist', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('fkc001', 'Link', 'fk_link');
      const field = fieldResult._unsafeUnwrap();

      const rule = FkColumnRule.forField(field, 'fk_link', 'target_table');
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('should create FK column with up() and validate it exists', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('fkc002', 'Link', 'fk_link');
      const field = fieldResult._unsafeUnwrap();

      const rule = FkColumnRule.forField(field, 'fk_link', 'target_table');
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('fkc003', 'Link', 'fk_link');
      const field = fieldResult._unsafeUnwrap();

      const rule = FkColumnRule.forField(field, 'fk_link', 'target_table');
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('IndexRule', () => {
    const TABLE_NAME = 'test_index_rule';

    it('should return invalid when index does not exist', async () => {
      await createTestTable(TABLE_NAME, ['name_col TEXT']);

      const fieldResult = createRealField('idx001', 'Name', 'name_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'name_col', 'other_table');
      const rule = IndexRule.forFkColumn(field, 'name_col', fkColumnRule);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('should create index with up() and validate it exists', async () => {
      await createTestTable(TABLE_NAME, ['name_col TEXT']);

      const fieldResult = createRealField('idx002', 'Name', 'name_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'name_col', 'other_table');
      const rule = IndexRule.forFkColumn(field, 'name_col', fkColumnRule);
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TABLE_NAME, ['name_col TEXT']);

      const fieldResult = createRealField('idx003', 'Name', 'name_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'name_col', 'other_table');
      const rule = IndexRule.forFkColumn(field, 'name_col', fkColumnRule);
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('UniqueIndexRule', () => {
    const TABLE_NAME = 'test_unique_index_rule';

    it('should return invalid when unique index does not exist', async () => {
      await createTestTable(TABLE_NAME, ['email_col TEXT']);

      const fieldResult = createRealField('uidx001', 'Email', 'email_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'email_col', 'other_table');
      const rule = UniqueIndexRule.forFkColumn(field, 'email_col', fkColumnRule);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('should return invalid when index exists but is not unique', async () => {
      await createTestTable(TABLE_NAME, ['email_col TEXT']);
      await sql
        .raw(`CREATE INDEX index_email_col ON ${TEST_SCHEMA}.${TABLE_NAME}(email_col)`)
        .execute(db);

      const fieldResult = createRealField('uidx002', 'Email', 'email_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'email_col', 'other_table');
      const rule = UniqueIndexRule.forFkColumn(field, 'email_col', fkColumnRule);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().missing?.some((m) => m.includes('not unique'))).toBe(true);
    });

    it('should create unique index with up() and validate it exists', async () => {
      await createTestTable(TABLE_NAME, ['email_col TEXT']);

      const fieldResult = createRealField('uidx003', 'Email', 'email_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'email_col', 'other_table');
      const rule = UniqueIndexRule.forFkColumn(field, 'email_col', fkColumnRule);
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TABLE_NAME, ['email_col TEXT']);

      const fieldResult = createRealField('uidx004', 'Email', 'email_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'email_col', 'other_table');
      const rule = UniqueIndexRule.forFkColumn(field, 'email_col', fkColumnRule);
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('ForeignKeyRule', () => {
    const SOURCE_TABLE = 'test_fk_source';
    const TARGET_TABLE = 'test_fk_target';

    it('should return invalid when FK constraint does not exist', async () => {
      await createTestTable(TARGET_TABLE);
      await createTestTable(SOURCE_TABLE, ['fk_col TEXT']);

      const fieldResult = createRealField('fk001', 'Link', 'fk_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'fk_col', TARGET_TABLE);
      const rule = ForeignKeyRule.forField(
        field,
        'fk_col',
        { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
        fkColumnRule,
        TARGET_TABLE
      );
      const ctx = createContext(SOURCE_TABLE, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('should create FK constraint with up() and validate it exists', async () => {
      await createTestTable(TARGET_TABLE);
      await createTestTable(SOURCE_TABLE, ['fk_col TEXT']);

      const fieldResult = createRealField('fk002', 'Link', 'fk_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'fk_col', TARGET_TABLE);
      const rule = ForeignKeyRule.forField(
        field,
        'fk_col',
        { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
        fkColumnRule,
        TARGET_TABLE
      );
      const ctx = createContext(SOURCE_TABLE, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TARGET_TABLE);
      await createTestTable(SOURCE_TABLE, ['fk_col TEXT']);

      const fieldResult = createRealField('fk003', 'Link', 'fk_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'fk_col', TARGET_TABLE);
      const rule = ForeignKeyRule.forField(
        field,
        'fk_col',
        { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
        fkColumnRule,
        TARGET_TABLE
      );
      const ctx = createContext(SOURCE_TABLE, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('OrderColumnRule', () => {
    const TABLE_NAME = 'test_order_column_rule';

    it('should return invalid when order column does not exist', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('ord001', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'link_col', 'target_table');
      const rule = OrderColumnRule.forField(
        field,
        'order_fld001',
        { schema: TEST_SCHEMA, tableName: TABLE_NAME },
        fkColumnRule
      );
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('should create order column with up() and validate it exists', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('ord002', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'link_col', 'target_table');
      const rule = OrderColumnRule.forField(
        field,
        'order_fld002',
        { schema: TEST_SCHEMA, tableName: TABLE_NAME },
        fkColumnRule
      );
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('ord003', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'link_col', 'target_table');
      const rule = OrderColumnRule.forField(
        field,
        'order_fld003',
        { schema: TEST_SCHEMA, tableName: TABLE_NAME },
        fkColumnRule
      );
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('LinkValueColumnRule', () => {
    const TABLE_NAME = 'test_link_value_column_rule';

    it('should return invalid when link value column does not exist', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('lvc001', 'Link', 'link_value_col');
      const field = fieldResult._unsafeUnwrap();

      const rule = LinkValueColumnRule.forField(field, 'oneWay');
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('should create link value column with up() and validate it exists', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('lvc002', 'Link', 'link_value_col');
      const field = fieldResult._unsafeUnwrap();

      const rule = LinkValueColumnRule.forField(field, 'oneWay');
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('lvc003', 'Link', 'link_value_col');
      const field = fieldResult._unsafeUnwrap();

      const rule = LinkValueColumnRule.forField(field, 'oneWay');
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('GeneratedColumnRule', () => {
    const TABLE_NAME = 'test_generated_column_rule';

    it('should return invalid when generated column does not exist', async () => {
      await createTestTable(TABLE_NAME, ['__created_time TIMESTAMPTZ DEFAULT NOW()']);

      const fieldResult = createRealField('gen001', 'CreatedTime', 'created_time_col');
      const field = fieldResult._unsafeUnwrap();

      const rule = GeneratedColumnRule.forCreatedTime(field);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('should create generated column with up() and validate it exists', async () => {
      await createTestTable(TABLE_NAME, ['__created_time TIMESTAMPTZ DEFAULT NOW()']);

      const fieldResult = createRealField('gen002', 'CreatedTime', 'created_time_col');
      const field = fieldResult._unsafeUnwrap();

      // Insert a field record for the GeneratedColumnRule (it updates field meta)
      await sql`INSERT INTO field (id, name, meta) VALUES (${field.id().toString()}, 'CreatedTime', '{}') ON CONFLICT (id) DO NOTHING`.execute(
        db
      );

      const rule = GeneratedColumnRule.forCreatedTime(field);
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TABLE_NAME, ['__created_time TIMESTAMPTZ DEFAULT NOW()']);

      const fieldResult = createRealField('gen003', 'CreatedTime', 'created_time_col');
      const field = fieldResult._unsafeUnwrap();

      await sql`INSERT INTO field (id, name, meta) VALUES (${field.id().toString()}, 'CreatedTime', '{}') ON CONFLICT (id) DO NOTHING`.execute(
        db
      );

      const rule = GeneratedColumnRule.forCreatedTime(field);
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('JunctionTableExistsRule', () => {
    const SOURCE_TABLE = 'test_junction_source';
    const TARGET_TABLE = 'test_junction_target';
    const JUNCTION_TABLE = 'junction_test';

    const createJunctionConfig = (): JunctionTableConfig => ({
      junctionTable: { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
      selfKeyName: 'self_key',
      foreignKeyName: 'foreign_key',
      orderColumnName: 'order_col',
      sourceTable: { schema: TEST_SCHEMA, tableName: SOURCE_TABLE },
      foreignTable: { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
      withIndexes: true,
    });

    it('should return invalid when junction table does not exist', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);

      const fieldResult = createRealField('jct001', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('jct001', 'Link');
      const rule = new JunctionTableExistsRule(linkField, createJunctionConfig());
      const ctx = createContext(SOURCE_TABLE, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().missing?.some((m) => m.includes('junction table'))).toBe(true);
    });

    it('should create junction table with up() and validate it exists', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);

      const fieldResult = createRealField('jct002', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('jct002', 'Link');
      const rule = new JunctionTableExistsRule(linkField, createJunctionConfig());
      const ctx = createContext(SOURCE_TABLE, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);

      const fieldResult = createRealField('jct003', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('jct003', 'Link');
      const rule = new JunctionTableExistsRule(linkField, createJunctionConfig());
      const ctx = createContext(SOURCE_TABLE, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });

    it('should allow junction table without order column when config omits it', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);

      await sql
        .raw(
          `CREATE TABLE ${TEST_SCHEMA}.${JUNCTION_TABLE} (
          __id SERIAL PRIMARY KEY,
          self_key TEXT,
          foreign_key TEXT
        )`
        )
        .execute(db);

      const fieldResult = createRealField('jct004', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('jct004', 'Link');
      const config = {
        junctionTable: { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        selfKeyName: 'self_key',
        foreignKeyName: 'foreign_key',
        sourceTable: { schema: TEST_SCHEMA, tableName: SOURCE_TABLE },
        foreignTable: { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
        withIndexes: true,
      } as unknown as JunctionTableConfig;

      const rule = new JunctionTableExistsRule(linkField, config);
      const ctx = createContext(SOURCE_TABLE, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(true);
    });
  });

  describe('JunctionTableUniqueConstraintRule', () => {
    const SOURCE_TABLE = 'test_jct_unique_source';
    const TARGET_TABLE = 'test_jct_unique_target';
    const JUNCTION_TABLE = 'junction_unique_test';

    it('should return invalid when unique constraint does not exist', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);
      await sql
        .raw(
          `CREATE TABLE ${TEST_SCHEMA}.${JUNCTION_TABLE} (
          __id SERIAL PRIMARY KEY,
          self_key TEXT,
          foreign_key TEXT,
          order_col DOUBLE PRECISION
        )`
        )
        .execute(db);

      const fieldResult = createRealField('jctu001', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('jctu001', 'Link');
      const config: JunctionTableConfig = {
        junctionTable: { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        selfKeyName: 'self_key',
        foreignKeyName: 'foreign_key',
        orderColumnName: 'order_col',
        sourceTable: { schema: TEST_SCHEMA, tableName: SOURCE_TABLE },
        foreignTable: { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
        withIndexes: false,
      };
      const junctionRule = new JunctionTableExistsRule(linkField, config);
      const rule = new JunctionTableUniqueConstraintRule(
        linkField,
        { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        'self_key',
        'foreign_key',
        junctionRule
      );
      const ctx = createContext(SOURCE_TABLE, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);
      await sql
        .raw(
          `CREATE TABLE ${TEST_SCHEMA}.${JUNCTION_TABLE} (
          __id SERIAL PRIMARY KEY,
          self_key TEXT,
          foreign_key TEXT,
          order_col DOUBLE PRECISION
        )`
        )
        .execute(db);

      const fieldResult = createRealField('jctu002', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('jctu002', 'Link');
      const config: JunctionTableConfig = {
        junctionTable: { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        selfKeyName: 'self_key',
        foreignKeyName: 'foreign_key',
        orderColumnName: 'order_col',
        sourceTable: { schema: TEST_SCHEMA, tableName: SOURCE_TABLE },
        foreignTable: { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
        withIndexes: false,
      };
      const junctionRule = new JunctionTableExistsRule(linkField, config);
      const rule = new JunctionTableUniqueConstraintRule(
        linkField,
        { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        'self_key',
        'foreign_key',
        junctionRule
      );
      const ctx = createContext(SOURCE_TABLE, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('JunctionTableIndexRule', () => {
    const SOURCE_TABLE = 'test_jct_index_source';
    const TARGET_TABLE = 'test_jct_index_target';
    const JUNCTION_TABLE = 'junction_index_test';

    it('should return invalid when index does not exist', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);
      await sql
        .raw(
          `CREATE TABLE ${TEST_SCHEMA}.${JUNCTION_TABLE} (
          __id SERIAL PRIMARY KEY,
          self_key TEXT,
          foreign_key TEXT,
          order_col DOUBLE PRECISION
        )`
        )
        .execute(db);

      const fieldResult = createRealField('jcti001', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('jcti001', 'Link');
      const config: JunctionTableConfig = {
        junctionTable: { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        selfKeyName: 'self_key',
        foreignKeyName: 'foreign_key',
        orderColumnName: 'order_col',
        sourceTable: { schema: TEST_SCHEMA, tableName: SOURCE_TABLE },
        foreignTable: { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
        withIndexes: true,
      };
      const junctionRule = new JunctionTableExistsRule(linkField, config);
      const rule = new JunctionTableIndexRule(
        linkField,
        { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        'self_key',
        'self',
        junctionRule
      );
      const ctx = createContext(SOURCE_TABLE, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);
      await sql
        .raw(
          `CREATE TABLE ${TEST_SCHEMA}.${JUNCTION_TABLE} (
          __id SERIAL PRIMARY KEY,
          self_key TEXT,
          foreign_key TEXT,
          order_col DOUBLE PRECISION
        )`
        )
        .execute(db);

      const fieldResult = createRealField('jcti002', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('jcti002', 'Link');
      const config: JunctionTableConfig = {
        junctionTable: { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        selfKeyName: 'self_key',
        foreignKeyName: 'foreign_key',
        orderColumnName: 'order_col',
        sourceTable: { schema: TEST_SCHEMA, tableName: SOURCE_TABLE },
        foreignTable: { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
        withIndexes: true,
      };
      const junctionRule = new JunctionTableExistsRule(linkField, config);
      const rule = new JunctionTableIndexRule(
        linkField,
        { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        'self_key',
        'self',
        junctionRule
      );
      const ctx = createContext(SOURCE_TABLE, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('JunctionTableForeignKeyRule', () => {
    const SOURCE_TABLE = 'test_jct_fk_source';
    const TARGET_TABLE = 'test_jct_fk_target';
    const JUNCTION_TABLE = 'junction_fk_test';

    it('should return invalid when FK does not exist', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);
      await sql
        .raw(
          `CREATE TABLE ${TEST_SCHEMA}.${JUNCTION_TABLE} (
          __id SERIAL PRIMARY KEY,
          self_key TEXT,
          foreign_key TEXT,
          order_col DOUBLE PRECISION
        )`
        )
        .execute(db);

      const fieldResult = createRealField('jctfk001', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('jctfk001', 'Link');
      const config: JunctionTableConfig = {
        junctionTable: { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        selfKeyName: 'self_key',
        foreignKeyName: 'foreign_key',
        orderColumnName: 'order_col',
        sourceTable: { schema: TEST_SCHEMA, tableName: SOURCE_TABLE },
        foreignTable: { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
        withIndexes: false,
      };
      const junctionRule = new JunctionTableExistsRule(linkField, config);
      const rule = new JunctionTableForeignKeyRule(
        linkField,
        { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        'self_key',
        { schema: TEST_SCHEMA, tableName: SOURCE_TABLE },
        'self',
        junctionRule
      );
      const ctx = createContext(SOURCE_TABLE, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);
      await sql
        .raw(
          `CREATE TABLE ${TEST_SCHEMA}.${JUNCTION_TABLE} (
          __id SERIAL PRIMARY KEY,
          self_key TEXT,
          foreign_key TEXT,
          order_col DOUBLE PRECISION
        )`
        )
        .execute(db);

      const fieldResult = createRealField('jctfk002', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('jctfk002', 'Link');
      const config: JunctionTableConfig = {
        junctionTable: { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        selfKeyName: 'self_key',
        foreignKeyName: 'foreign_key',
        orderColumnName: 'order_col',
        sourceTable: { schema: TEST_SCHEMA, tableName: SOURCE_TABLE },
        foreignTable: { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
        withIndexes: false,
      };
      const junctionRule = new JunctionTableExistsRule(linkField, config);
      const rule = new JunctionTableForeignKeyRule(
        linkField,
        { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        'self_key',
        { schema: TEST_SCHEMA, tableName: SOURCE_TABLE },
        'self',
        junctionRule
      );
      const ctx = createContext(SOURCE_TABLE, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('FieldMetaRule', () => {
    const TABLE_NAME = 'test_field_meta_rule';

    it('should return invalid when field record does not exist', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('fmr001', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const rule = FieldMetaRule.forOrderColumn(field);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().missing?.some((m) => m.includes('not found'))).toBe(true);
    });

    it('should return invalid when meta is missing expected keys', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('fmr002', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      // Insert field record with empty meta
      await sql`INSERT INTO field (id, name, meta) VALUES (${field.id().toString()}, 'Link', '{}') ON CONFLICT (id) DO NOTHING`.execute(
        db
      );

      const rule = FieldMetaRule.forOrderColumn(field);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().missing?.some((m) => m.includes('hasOrderColumn'))).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('fmr003', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      // Insert field record with empty meta
      await sql`INSERT INTO field (id, name, meta) VALUES (${field.id().toString()}, 'Link', '{}') ON CONFLICT (id) DO NOTHING`.execute(
        db
      );

      const rule = FieldMetaRule.forOrderColumn(field);
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      // After down, meta is set to {} which doesn't have hasOrderColumn
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('ReferenceRule', () => {
    const TABLE_NAME = 'test_reference_rule';

    it('should return valid when no references expected', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('ref001', 'Text', 'text_col');
      const field = fieldResult._unsafeUnwrap();

      const rule = new ReferenceRule(field, []);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(true);
    });

    it('should return invalid when reference entry does not exist', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('ref002', 'Formula', 'formula_col');
      const field = fieldResult._unsafeUnwrap();

      const rule = ReferenceRule.single(field, 'fld_source_field_001', { fieldType: 'formula' });
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().missing?.some((m) => m.includes('reference entry'))).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('ref003', 'Formula', 'formula_col');
      const field = fieldResult._unsafeUnwrap();

      const rule = ReferenceRule.single(field, 'fld_source_field_001', { fieldType: 'formula' });
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });

    it('should handle multiple references', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('ref004', 'Rollup', 'rollup_col');
      const field = fieldResult._unsafeUnwrap();

      const rule = ReferenceRule.multiple(field, ['fld_link_field_001', 'fld_value_field_001'], {
        fieldType: 'rollup',
      });
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('SchemaChecker', () => {
    const TABLE_NAME = 'test_schema_checker_rule';

    it('should report error when required column is missing', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('chk001', 'Name', 'name_col');
      const field = fieldResult._unsafeUnwrap();
      const table = createTableAggregate(TABLE_NAME, field);

      const checker = createSchemaChecker({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const results = await collectFinalResults(checker.checkField(table, field.id().toString()));

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('error');
      expect(results[0].ruleId).toBe(`column:${field.id().toString()}`);
    });

    it('should report success when required column exists', async () => {
      await createTestTable(TABLE_NAME, ['name_col TEXT']);

      const fieldResult = createRealField('chk002', 'Name', 'name_col');
      const field = fieldResult._unsafeUnwrap();
      const table = createTableAggregate(TABLE_NAME, field);

      const checker = createSchemaChecker({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const results = await collectFinalResults(checker.checkField(table, field.id().toString()));

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('success');
      expect(results[0].ruleId).toBe(`column:${field.id().toString()}`);
    });
  });
});
