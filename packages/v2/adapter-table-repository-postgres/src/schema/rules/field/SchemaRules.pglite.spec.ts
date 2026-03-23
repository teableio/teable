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
  createConditionalLookupFieldPending,
  createCreatedTimeField,
  createLinkField,
  createLookupFieldPending,
  createSingleLineTextField,
  ConditionalLookupOptions,
  DbFieldName,
  DbTableName,
  FieldId,
  LinkFieldConfig,
  LinkFieldMeta,
  FieldName,
  FieldNotNull,
  FieldUnique,
  GeneratedColumnMeta,
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
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createSchemaChecker } from '../checker/SchemaChecker';
import type { SchemaCheckResult } from '../checker/SchemaCheckResult';
import { PostgresSchemaIntrospector } from '../context/PostgresSchemaIntrospector';
import type { SchemaIntrospector } from '../context/SchemaIntrospector';
import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import { createSchemaRepairer } from '../repairer/SchemaRepairer';
import type { SchemaRepairResult } from '../repairer/SchemaRepairResult';
import { SYSTEM_RULE_FIELD_ID } from '../table/SystemTableRules';
import { ColumnExistsRule } from './ColumnExistsRule';
import { ColumnUniqueConstraintRule } from './ColumnUniqueConstraintRule';
import { FieldMetaRule } from './FieldMetaRule';
import { createFieldSchemaRules } from './FieldSchemaRulesFactory';
import { FkColumnRule } from './FkColumnRule';
import { ForeignKeyRule } from './ForeignKeyRule';
import { GeneratedColumnMetaRule } from './GeneratedColumnMetaRule';
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

const createCreatedTimeFieldWithGeneratedMeta = (
  id: string,
  name: string,
  dbFieldName: string,
  persistedAsGeneratedColumn: boolean
): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const dbFieldResult = DbFieldName.rehydrate(dbFieldName);
  if (dbFieldResult.isErr()) return err(dbFieldResult.error);

  const metaResult = GeneratedColumnMeta.rehydrate({ persistedAsGeneratedColumn });
  if (metaResult.isErr()) return err(metaResult.error);

  const fieldResult = createCreatedTimeField({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
    meta: metaResult.value,
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

const createSelfLookupField = (
  id: string,
  name: string,
  dbFieldName: string
): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const sharedDependencyFieldId = createValidFieldId(`dep_${id}`);
  const lookupOptionsResult = LookupOptions.create({
    linkFieldId: sharedDependencyFieldId,
    lookupFieldId: sharedDependencyFieldId,
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

const createRealLinkField = (params: {
  id: string;
  name: string;
  dbFieldName: string;
  relationship: 'manyMany' | 'oneMany' | 'manyOne' | 'oneOne';
  foreignTableId: string;
  fkHostTableName: string;
  selfKeyName: string;
  foreignKeyName: string;
  isOneWay?: boolean;
  hasOrderColumn?: boolean;
  symmetricFieldId?: string;
}): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(params.id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(params.name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const dbFieldResult = DbFieldName.rehydrate(params.dbFieldName);
  if (dbFieldResult.isErr()) return err(dbFieldResult.error);

  const configResult = LinkFieldConfig.create({
    relationship: params.relationship,
    foreignTableId: params.foreignTableId,
    lookupFieldId: createValidFieldId(`lookup_${params.id}`),
    fkHostTableName: params.fkHostTableName,
    selfKeyName: params.selfKeyName,
    foreignKeyName: params.foreignKeyName,
    isOneWay: params.isOneWay,
    symmetricFieldId: params.symmetricFieldId,
  });
  if (configResult.isErr()) return err(configResult.error);

  const metaResult = LinkFieldMeta.create({ hasOrderColumn: params.hasOrderColumn ?? false });
  if (metaResult.isErr()) return err(metaResult.error);

  const fieldResult = createLinkField({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
    config: configResult.value,
    meta: metaResult.value,
  });
  if (fieldResult.isErr()) return err(fieldResult.error);

  const setResult = fieldResult.value.setDbFieldName(dbFieldResult.value);
  if (setResult.isErr()) return err(setResult.error);

  return fieldResult;
};

/**
 * Create a mock LinkField for junction table tests.
 */
const createMockLinkField = (
  id: string,
  name: string,
  options: {
    relationship?: 'manyMany' | 'oneMany' | 'manyOne' | 'oneOne';
    isOneWay?: boolean;
    dbFieldName?: string;
  } = {}
): LinkField => {
  return {
    id: () => ({ toString: () => createValidFieldId(id) }),
    name: () => ({ toString: () => name }),
    relationship: () => ({ toString: () => options.relationship ?? 'manyMany' }),
    isOneWay: () => options.isOneWay ?? false,
    dbFieldName: () =>
      ok({
        value: () => ok(options.dbFieldName ?? 'link_value'),
      }),
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

  const createExplicitTestTable = async (tableName: string, columns: string[]) => {
    const query = `CREATE TABLE ${TEST_SCHEMA}.${tableName} (${columns.join(', ')})`;
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

  const collectFinalRepairResults = async (
    generator: AsyncGenerator<SchemaRepairResult, void, unknown>
  ): Promise<SchemaRepairResult[]> => {
    const results: SchemaRepairResult[] = [];
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

    it('down should remove a constraint-backed unique created by constraint updates', async () => {
      await createTestTable(TABLE_NAME, ['email_col TEXT']);

      const fieldResult = createRealField('uniq004', 'Email', 'email_col', { unique: true });
      const field = fieldResult._unsafeUnwrap();

      const columnRule = new ColumnExistsRule(field);
      const rule = new ColumnUniqueConstraintRule(field, columnRule);
      const ctx = createContext(TABLE_NAME, field);

      await db.executeQuery(
        sql`ALTER TABLE ${sql.ref(TEST_SCHEMA)}.${sql.ref(TABLE_NAME)} ADD CONSTRAINT ${sql.ref(
          `${TABLE_NAME}_email_col_unique`
        )} UNIQUE (${sql.ref('email_col')})`.compile(db)
      );

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

    it('should backfill FK values from the persisted link JSON column', async () => {
      await createTestTable(TABLE_NAME, ['link_value JSONB']);
      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${TABLE_NAME} (__id, link_value)
          VALUES
            ('rec_alpha', '{"id":"rec_target_a","title":"Target A"}'::jsonb),
            ('rec_beta', '{"id":"rec_target_b","title":"Target B"}'::jsonb),
            ('rec_empty', NULL)
        `
        )
        .execute(db);

      const fieldResult = createRealField('fkc004', 'Link', 'link_value');
      const field = fieldResult._unsafeUnwrap();

      const rule = FkColumnRule.forField(field, '__fk_link', 'target_table');
      const ctx = createContext(TABLE_NAME, field);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      const rows = await sql<{ record_id: string; fk: string | null }>`
        SELECT __id AS record_id, "__fk_link" AS fk
        FROM ${sql.id(TEST_SCHEMA)}.${sql.id(TABLE_NAME)}
        ORDER BY __id
      `.execute(db);

      expect(rows.rows).toEqual([
        { record_id: 'rec_alpha', fk: 'rec_target_a' },
        { record_id: 'rec_beta', fk: 'rec_target_b' },
        { record_id: 'rec_empty', fk: null },
      ]);
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

  describe('GeneratedColumnMetaRule', () => {
    const TABLE_NAME = 'test_generated_column_meta_rule';

    it('should return invalid when field meta expects a stored column but db column is generated', async () => {
      await createTestTable(TABLE_NAME, [
        '__created_time TIMESTAMPTZ DEFAULT NOW()',
        'created_time_col TIMESTAMPTZ GENERATED ALWAYS AS (__created_time) STORED',
      ]);

      const field = createCreatedTimeFieldWithGeneratedMeta(
        'genm001',
        'CreatedTime',
        'created_time_col',
        false
      )._unsafeUnwrap();

      const generatedRule = GeneratedColumnRule.forCreatedTime(field);
      const rule = new GeneratedColumnMetaRule(field, generatedRule, new ColumnExistsRule(field));
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().extra?.[0]).toContain('persistedAsGeneratedColumn is false');
    });

    it('up then down should switch between stored and generated column states', async () => {
      await createTestTable(TABLE_NAME, [
        '__created_time TIMESTAMPTZ DEFAULT NOW()',
        'created_time_col TIMESTAMPTZ GENERATED ALWAYS AS (__created_time) STORED',
      ]);

      const field = createCreatedTimeFieldWithGeneratedMeta(
        'genm002',
        'CreatedTime',
        'created_time_col',
        false
      )._unsafeUnwrap();

      const generatedRule = GeneratedColumnRule.forCreatedTime(field);
      const rule = new GeneratedColumnMetaRule(field, generatedRule, new ColumnExistsRule(field));
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      const storedColumnResult = await introspector.getColumn(
        TEST_SCHEMA,
        TABLE_NAME,
        'created_time_col'
      );
      expect(storedColumnResult._unsafeUnwrap()?.isGenerated).toBe(false);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
      expect((await generatedRule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);
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

    it('should backfill junction rows from the persisted link JSON column', async () => {
      await createTestTable(SOURCE_TABLE, ['link_value JSONB']);
      await createTestTable(TARGET_TABLE);
      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${SOURCE_TABLE} (__id, link_value)
          VALUES
            (
              'rec_source_1',
              '[{"id":"rec_foreign_1","title":"Foreign 1"},{"id":"rec_foreign_2","title":"Foreign 2"}]'::jsonb
            ),
            (
              'rec_source_2',
              '[{"id":"rec_foreign_3","title":"Foreign 3"}]'::jsonb
            )
        `
        )
        .execute(db);

      const fieldResult = createRealField('jct005', 'Link', 'link_value');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('jct005', 'Link', { dbFieldName: 'link_value' });
      const rule = new JunctionTableExistsRule(linkField, createJunctionConfig());
      const ctx = createContext(SOURCE_TABLE, field);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      const rows = await sql<{
        self_key: string;
        foreign_key: string;
        order_col: number;
      }>`
        SELECT self_key, foreign_key, order_col
        FROM ${sql.id(TEST_SCHEMA)}.${sql.id(JUNCTION_TABLE)}
        ORDER BY self_key, order_col
      `.execute(db);

      expect(rows.rows).toEqual([
        { self_key: 'rec_source_1', foreign_key: 'rec_foreign_1', order_col: 1 },
        { self_key: 'rec_source_1', foreign_key: 'rec_foreign_2', order_col: 2 },
        { self_key: 'rec_source_2', foreign_key: 'rec_foreign_3', order_col: 1 },
      ]);
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

    it('should deduplicate self-lookup reference rules when link and lookup ids match', () => {
      const field = createSelfLookupField(
        'self_lookup001',
        'SelfLookup',
        'self_lookup_col'
      )._unsafeUnwrap();
      const rulesResult = createFieldSchemaRules(field, {
        schema: TEST_SCHEMA,
        tableName: 'self_lookup_table',
        tableId: 'self_lookup_table',
      });

      expect(rulesResult.isOk()).toBe(true);

      const referenceRules = rulesResult
        ._unsafeUnwrap()
        .filter((rule) => rule instanceof ReferenceRule);
      expect(referenceRules).toHaveLength(1);
      expect(referenceRules[0].id).toBe(
        `reference:${field.id().toString()}:${createValidFieldId('dep_self_lookup001')}`
      );
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

    it('should report generated-column metadata drift when field meta expects a stored column', async () => {
      await createTestTable(TABLE_NAME, [
        '__created_time TIMESTAMPTZ DEFAULT NOW()',
        'created_time_col TIMESTAMPTZ GENERATED ALWAYS AS (__created_time) STORED',
      ]);

      const field = createCreatedTimeFieldWithGeneratedMeta(
        'chk003',
        'CreatedTime',
        'created_time_col',
        false
      )._unsafeUnwrap();
      const table = createTableAggregate(TABLE_NAME, field);

      const checker = createSchemaChecker({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const results = await collectFinalResults(checker.checkField(table, field.id().toString()));

      expect(
        results.find((result) => result.ruleId === `generated_meta:${field.id().toString()}`)
          ?.status
      ).toBe('error');
      expect(
        results.find((result) => result.ruleId === `column:${field.id().toString()}`)?.status
      ).toBe('success');
    });
  });

  describe('SchemaRepairer', () => {
    it('should report missing system __id uniqueness when checking system rules', async () => {
      const tableName = 'test_schema_system_rule_check';
      await createExplicitTestTable(tableName, [
        '__id TEXT NOT NULL',
        '__auto_number SERIAL PRIMARY KEY',
        '__created_time TIMESTAMPTZ NOT NULL DEFAULT NOW()',
        '__last_modified_time TIMESTAMPTZ',
        '__created_by TEXT NOT NULL',
        '__last_modified_by TEXT',
        '__version INTEGER NOT NULL',
        'name_col TEXT',
      ]);

      const field = createRealField('sys001', 'Name', 'name_col')._unsafeUnwrap();
      const table = createTableAggregate(tableName, field);
      const checker = createSchemaChecker({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const results = await collectFinalResults(checker.checkField(table, SYSTEM_RULE_FIELD_ID));
      const uniqueRule = results.find((result) => result.ruleId === 'system_unique:__id');

      expect(uniqueRule?.status).toBe('error');
      expect(uniqueRule?.details?.missing).toContain(
        'system column "__id" should have UNIQUE index'
      );
    });

    it('should error when system __auto_number primary key is missing', async () => {
      const tableName = 'test_schema_system_primary_key_warn';
      await createExplicitTestTable(tableName, [
        '__id TEXT NOT NULL UNIQUE',
        '__auto_number INTEGER',
        '__created_time TIMESTAMPTZ NOT NULL DEFAULT NOW()',
        '__last_modified_time TIMESTAMPTZ',
        '__created_by TEXT NOT NULL',
        '__last_modified_by TEXT',
        '__version INTEGER NOT NULL',
        'name_col TEXT',
      ]);

      const field = createRealField('sys001b', 'Name', 'name_col')._unsafeUnwrap();
      const table = createTableAggregate(tableName, field);
      const checker = createSchemaChecker({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const results = await collectFinalResults(checker.checkField(table, SYSTEM_RULE_FIELD_ID));
      const primaryKeyRule = results.find(
        (result) => result.ruleId === 'system_primary_key:__auto_number'
      );

      expect(primaryKeyRule?.status).toBe('error');
      expect(primaryKeyRule?.details?.missing).toContain(
        'system column "__auto_number" should be PRIMARY KEY'
      );
    });

    it('should repair system columns when repairing the system rule scope', async () => {
      const tableName = 'test_schema_system_repair_scope';
      await createExplicitTestTable(tableName, [
        '__id TEXT',
        '__auto_number INTEGER',
        '__created_time TIMESTAMPTZ',
        '__last_modified_time TIMESTAMPTZ',
        '__created_by TEXT',
        '__last_modified_by TEXT',
        '__version INTEGER',
        'name_col TEXT',
      ]);

      const field = createRealField('sys002', 'Name', 'name_col')._unsafeUnwrap();
      const table = createTableAggregate(tableName, field);
      const repairer = createSchemaRepairer({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const repairResults = await collectFinalRepairResults(
        repairer.repairField(table, SYSTEM_RULE_FIELD_ID)
      );

      expect(
        repairResults.some(
          (result) => result.ruleId === 'system_unique:__id' && result.outcome === 'repaired'
        )
      ).toBe(true);
      expect(
        repairResults.some(
          (result) =>
            result.ruleId === 'system_primary_key:__auto_number' && result.outcome === 'repaired'
        )
      ).toBe(true);

      const checker = createSchemaChecker({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });
      const checkResults = await collectFinalResults(
        checker.checkField(table, SYSTEM_RULE_FIELD_ID)
      );
      expect(checkResults.every((result) => result.status === 'success')).toBe(true);
    });

    it('should repair a single system rule using the system scope id', async () => {
      const tableName = 'test_schema_system_rule_repair';
      await createExplicitTestTable(tableName, [
        '__id TEXT NOT NULL',
        '__auto_number SERIAL PRIMARY KEY',
        '__created_time TIMESTAMPTZ NOT NULL DEFAULT NOW()',
        '__last_modified_time TIMESTAMPTZ',
        '__created_by TEXT NOT NULL',
        '__last_modified_by TEXT',
        '__version INTEGER NOT NULL',
        'title_col TEXT',
      ]);

      const field = createRealField('sys003', 'Title', 'title_col')._unsafeUnwrap();
      const table = createTableAggregate(tableName, field);
      const repairer = createSchemaRepairer({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const repairResults = await collectFinalRepairResults(
        repairer.repairRule(table, SYSTEM_RULE_FIELD_ID, 'system_unique:__id')
      );

      expect(repairResults.find((result) => result.ruleId === 'system_unique:__id')?.outcome).toBe(
        'repaired'
      );

      const checker = createSchemaChecker({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });
      const checkResults = await collectFinalResults(
        checker.checkField(table, SYSTEM_RULE_FIELD_ID)
      );
      expect(checkResults.find((result) => result.ruleId === 'system_unique:__id')?.status).toBe(
        'success'
      );
    });

    it('should repair a missing column when repairing a table', async () => {
      const tableName = 'test_schema_repair_table';
      await createTestTable(tableName);

      const field = createRealField('rpt001', 'Name', 'name_col')._unsafeUnwrap();
      const table = createTableAggregate(tableName, field);
      const repairer = createSchemaRepairer({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const results = await collectFinalRepairResults(repairer.repairTable(table));

      expect(
        results.find((result) => result.ruleId === `column:${field.id().toString()}`)?.status
      ).toBe('success');
      expect(
        results.find((result) => result.ruleId === `column:${field.id().toString()}`)?.outcome
      ).toBe('repaired');

      const checker = createSchemaChecker({ db, introspector, schema: TEST_SCHEMA });
      const checkResults = await collectFinalResults(
        checker.checkField(table, field.id().toString())
      );
      expect(checkResults.every((result) => result.status === 'success')).toBe(true);
    });

    it('should repair a missing column when repairing a field', async () => {
      const tableName = 'test_schema_repair_field';
      await createTestTable(tableName);

      const field = createRealField('rpf001', 'Title', 'title_col')._unsafeUnwrap();
      const table = createTableAggregate(tableName, field);
      const repairer = createSchemaRepairer({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const results = await collectFinalRepairResults(
        repairer.repairField(table, field.id().toString())
      );

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('success');
      expect(results[0].outcome).toBe('repaired');
      expect(results[0].ruleId).toBe(`column:${field.id().toString()}`);
    });

    it('should repair generated-column metadata drift for stored columns', async () => {
      const tableName = 'test_schema_repair_generated_meta';
      await createTestTable(tableName, [
        '__created_time TIMESTAMPTZ DEFAULT NOW()',
        'created_time_col TIMESTAMPTZ GENERATED ALWAYS AS (__created_time) STORED',
      ]);

      const field = createCreatedTimeFieldWithGeneratedMeta(
        'rpg001',
        'CreatedTime',
        'created_time_col',
        false
      )._unsafeUnwrap();
      const table = createTableAggregate(tableName, field);
      const repairer = createSchemaRepairer({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const results = await collectFinalRepairResults(
        repairer.repairField(table, field.id().toString())
      );

      expect(
        results.find((result) => result.ruleId === `generated_meta:${field.id().toString()}`)
          ?.outcome
      ).toBe('repaired');

      const checker = createSchemaChecker({ db, introspector, schema: TEST_SCHEMA });
      const checkResults = await collectFinalResults(
        checker.checkField(table, field.id().toString())
      );
      expect(checkResults.every((result) => result.status === 'success')).toBe(true);
    });

    it.each([
      {
        label: 'manyOne',
        relationship: 'manyOne' as const,
        fieldSeed: 'rplink_many_one',
        fkColumnName: '__fk_many_one',
        expectUnique: false,
      },
      {
        label: 'oneOne',
        relationship: 'oneOne' as const,
        fieldSeed: 'rplink_one_one',
        fkColumnName: '__fk_one_one',
        expectUnique: true,
      },
    ])(
      'should repair a dropped FK column and backfill persisted link values for $label links',
      async ({ fieldSeed, relationship, fkColumnName, expectUnique }) => {
        const sourceTableName = createValidTableId(`src_${fieldSeed}`);
        const targetTableName = createValidTableId(`tgt_${fieldSeed}`);

        await createTestTable(targetTableName);
        await createTestTable(sourceTableName, ['link_value JSONB', `${fkColumnName} TEXT`]);

        await sql
          .raw(
            `
            INSERT INTO ${TEST_SCHEMA}.${targetTableName} (__id)
            VALUES ('rec_target_a'), ('rec_target_b')
          `
          )
          .execute(db);
        await sql
          .raw(
            `
            INSERT INTO ${TEST_SCHEMA}.${sourceTableName} (__id, link_value, "${fkColumnName}")
            VALUES
              ('rec_source_a', '{"id":"rec_target_a","title":"Target A"}'::jsonb, 'rec_target_a'),
              ('rec_source_b', '{"id":"rec_target_b","title":"Target B"}'::jsonb, 'rec_target_b')
          `
          )
          .execute(db);

        const field = createRealLinkField({
          id: fieldSeed,
          name: `${relationship} Link`,
          dbFieldName: 'link_value',
          relationship,
          foreignTableId: targetTableName,
          fkHostTableName: sourceTableName,
          selfKeyName: '__id',
          foreignKeyName: fkColumnName,
          hasOrderColumn: false,
        })._unsafeUnwrap();
        const table = createTableAggregate(sourceTableName, field);

        await sql
          .raw(
            `ALTER TABLE ${TEST_SCHEMA}.${sourceTableName} DROP COLUMN "${fkColumnName}" CASCADE`
          )
          .execute(db);

        const repairer = createSchemaRepairer({ db, introspector, schema: TEST_SCHEMA });
        const repairResults = await collectFinalRepairResults(
          repairer.repairField(table, field.id().toString())
        );

        expect(
          repairResults.find((result) => result.ruleId === `fk_column:${field.id().toString()}`)
            ?.outcome
        ).toBe('repaired');

        const repairedRows = await sql<{ record_id: string; fk_value: string | null }>`
          SELECT __id AS record_id, ${sql.id(fkColumnName)} AS fk_value
          FROM ${sql.id(TEST_SCHEMA)}.${sql.id(sourceTableName)}
          ORDER BY __id
        `.execute(db);

        expect(repairedRows.rows).toEqual([
          { record_id: 'rec_source_a', fk_value: 'rec_target_a' },
          { record_id: 'rec_source_b', fk_value: 'rec_target_b' },
        ]);

        const checker = createSchemaChecker({ db, introspector, schema: TEST_SCHEMA });
        const checkResults = await collectFinalResults(
          checker.checkField(table, field.id().toString())
        );

        expect(
          checkResults.find((result) => result.ruleId === `fk_column:${field.id().toString()}`)
            ?.status
        ).toBe('success');
        expect(
          checkResults.find(
            (result) => result.ruleId === `fk:${field.id().toString()}:${fkColumnName}`
          )?.status
        ).toBe('success');

        const expectedIndexRuleId = expectUnique
          ? `unique_index:${field.id().toString()}:${fkColumnName}`
          : `index:${field.id().toString()}:${fkColumnName}`;
        expect(checkResults.find((result) => result.ruleId === expectedIndexRuleId)?.status).toBe(
          'success'
        );
      }
    );

    it('should repair the FK host column for two-way oneMany links from the source link JSON copy', async () => {
      const sourceTableName = createValidTableId('src_one_many_two_way');
      const targetTableName = createValidTableId('tgt_one_many_two_way');
      const hostFkColumnName = '__fk_one_many_host';

      await createTestTable(sourceTableName, ['link_value JSONB']);
      await createTestTable(targetTableName, [`${hostFkColumnName} TEXT`]);

      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${sourceTableName} (__id, link_value)
          VALUES
            ('rec_source_a', '[{"id":"rec_target_a","title":"Target A"},{"id":"rec_target_b","title":"Target B"}]'::jsonb),
            ('rec_source_b', '[{"id":"rec_target_c","title":"Target C"}]'::jsonb)
        `
        )
        .execute(db);
      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${targetTableName} (__id, "${hostFkColumnName}")
          VALUES
            ('rec_target_a', 'rec_source_a'),
            ('rec_target_b', 'rec_source_a'),
            ('rec_target_c', 'rec_source_b')
        `
        )
        .execute(db);

      const field = createRealLinkField({
        id: 'rplink_one_many_two_way',
        name: 'OneMany Link',
        dbFieldName: 'link_value',
        relationship: 'oneMany',
        foreignTableId: targetTableName,
        fkHostTableName: targetTableName,
        selfKeyName: hostFkColumnName,
        foreignKeyName: '__id',
        isOneWay: false,
        hasOrderColumn: false,
      })._unsafeUnwrap();
      const table = createTableAggregate(sourceTableName, field);

      await sql
        .raw(
          `ALTER TABLE ${TEST_SCHEMA}.${targetTableName} DROP COLUMN "${hostFkColumnName}" CASCADE`
        )
        .execute(db);

      const repairer = createSchemaRepairer({ db, introspector, schema: TEST_SCHEMA });
      const repairResults = await collectFinalRepairResults(
        repairer.repairField(table, field.id().toString())
      );

      expect(
        repairResults.find((result) => result.ruleId === `fk_column:${field.id().toString()}`)
          ?.outcome
      ).toBe('repaired');

      const repairedRows = await sql<{ record_id: string; fk_value: string | null }>`
        SELECT __id AS record_id, ${sql.id(hostFkColumnName)} AS fk_value
        FROM ${sql.id(TEST_SCHEMA)}.${sql.id(targetTableName)}
        ORDER BY __id
      `.execute(db);

      expect(repairedRows.rows).toEqual([
        { record_id: 'rec_target_a', fk_value: 'rec_source_a' },
        { record_id: 'rec_target_b', fk_value: 'rec_source_a' },
        { record_id: 'rec_target_c', fk_value: 'rec_source_b' },
      ]);

      const checker = createSchemaChecker({ db, introspector, schema: TEST_SCHEMA });
      const checkResults = await collectFinalResults(
        checker.checkField(table, field.id().toString())
      );
      expect(
        checkResults.find(
          (result) => result.ruleId === `fk:${field.id().toString()}:${hostFkColumnName}`
        )?.status
      ).toBe('success');
      expect(
        checkResults.find(
          (result) => result.ruleId === `index:${field.id().toString()}:${hostFkColumnName}`
        )?.status
      ).toBe('success');
    });

    it('should repair a dropped junction table and backfill one-way oneMany link rows', async () => {
      const sourceTableName = createValidTableId('src_one_many_one_way');
      const targetTableName = createValidTableId('tgt_one_many_one_way');
      const junctionTableName = 'junction_one_many_one_way';
      const selfKeyName = '__fk_one_way_self';
      const foreignKeyName = '__fk_one_way_foreign';

      await createTestTable(sourceTableName, ['link_value JSONB']);
      await createTestTable(targetTableName);
      await createExplicitTestTable(junctionTableName, [
        '__id SERIAL PRIMARY KEY',
        `${selfKeyName} TEXT`,
        `${foreignKeyName} TEXT`,
      ]);

      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${sourceTableName} (__id, link_value)
          VALUES
            ('rec_source_a', '[{"id":"rec_target_a","title":"Target A"},{"id":"rec_target_b","title":"Target B"}]'::jsonb)
        `
        )
        .execute(db);
      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${targetTableName} (__id)
          VALUES ('rec_target_a'), ('rec_target_b')
        `
        )
        .execute(db);
      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${junctionTableName} (${selfKeyName}, ${foreignKeyName})
          VALUES ('rec_source_a', 'rec_target_a'), ('rec_source_a', 'rec_target_b')
        `
        )
        .execute(db);

      const field = createRealLinkField({
        id: 'rplink_one_many_one_way',
        name: 'OneWay OneMany Link',
        dbFieldName: 'link_value',
        relationship: 'oneMany',
        foreignTableId: targetTableName,
        fkHostTableName: junctionTableName,
        selfKeyName,
        foreignKeyName,
        isOneWay: true,
        hasOrderColumn: false,
      })._unsafeUnwrap();
      const table = createTableAggregate(sourceTableName, field);

      await sql.raw(`DROP TABLE ${TEST_SCHEMA}.${junctionTableName}`).execute(db);

      const repairer = createSchemaRepairer({ db, introspector, schema: TEST_SCHEMA });
      const repairResults = await collectFinalRepairResults(
        repairer.repairField(table, field.id().toString())
      );

      expect(
        repairResults.find((result) => result.ruleId === `junction_table:${field.id().toString()}`)
          ?.outcome
      ).toBe('repaired');

      const junctionRows = await sql<{ self_id: string; foreign_id: string }>`
        SELECT ${sql.id(selfKeyName)} AS self_id, ${sql.id(foreignKeyName)} AS foreign_id
        FROM ${sql.id(TEST_SCHEMA)}.${sql.id(junctionTableName)}
        ORDER BY ${sql.id(selfKeyName)}, ${sql.id(foreignKeyName)}
      `.execute(db);

      expect(junctionRows.rows).toEqual([
        { self_id: 'rec_source_a', foreign_id: 'rec_target_a' },
        { self_id: 'rec_source_a', foreign_id: 'rec_target_b' },
      ]);
    });

    it('should repair a dropped junction table and backfill manyMany link rows with order', async () => {
      const sourceTableName = createValidTableId('src_many_many_repair');
      const targetTableName = createValidTableId('tgt_many_many_repair');
      const junctionTableName = 'junction_many_many_repair';
      const selfKeyName = '__fk_many_many_self';
      const foreignKeyName = '__fk_many_many_foreign';

      await createTestTable(sourceTableName, ['link_value JSONB']);
      await createTestTable(targetTableName);
      await createExplicitTestTable(junctionTableName, [
        '__id SERIAL PRIMARY KEY',
        `${selfKeyName} TEXT`,
        `${foreignKeyName} TEXT`,
        '__order DOUBLE PRECISION',
      ]);

      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${sourceTableName} (__id, link_value)
          VALUES
            ('rec_source_a', '[{"id":"rec_target_b","title":"Target B"},{"id":"rec_target_a","title":"Target A"}]'::jsonb)
        `
        )
        .execute(db);
      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${targetTableName} (__id)
          VALUES ('rec_target_a'), ('rec_target_b')
        `
        )
        .execute(db);
      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${junctionTableName} (${selfKeyName}, ${foreignKeyName}, "__order")
          VALUES ('rec_source_a', 'rec_target_b', 1), ('rec_source_a', 'rec_target_a', 2)
        `
        )
        .execute(db);

      const field = createRealLinkField({
        id: 'rplink_many_many',
        name: 'ManyMany Link',
        dbFieldName: 'link_value',
        relationship: 'manyMany',
        foreignTableId: targetTableName,
        fkHostTableName: junctionTableName,
        selfKeyName,
        foreignKeyName,
        hasOrderColumn: true,
      })._unsafeUnwrap();
      const table = createTableAggregate(sourceTableName, field);

      await sql.raw(`DROP TABLE ${TEST_SCHEMA}.${junctionTableName}`).execute(db);

      const repairer = createSchemaRepairer({ db, introspector, schema: TEST_SCHEMA });
      const repairResults = await collectFinalRepairResults(
        repairer.repairField(table, field.id().toString())
      );

      expect(
        repairResults.find((result) => result.ruleId === `junction_table:${field.id().toString()}`)
          ?.outcome
      ).toBe('repaired');

      const junctionRows = await sql<{ self_id: string; foreign_id: string; order_value: number }>`
        SELECT
          ${sql.id(selfKeyName)} AS self_id,
          ${sql.id(foreignKeyName)} AS foreign_id,
          "__order" AS order_value
        FROM ${sql.id(TEST_SCHEMA)}.${sql.id(junctionTableName)}
        ORDER BY "__order"
      `.execute(db);

      expect(junctionRows.rows).toEqual([
        { self_id: 'rec_source_a', foreign_id: 'rec_target_b', order_value: 1 },
        { self_id: 'rec_source_a', foreign_id: 'rec_target_a', order_value: 2 },
      ]);
    });

    it('should repair a single reference rule using a checker-provided rule id', async () => {
      const tableName = 'test_schema_repair_rule';
      await createTestTable(tableName, ['lookup_col TEXT']);

      const field = createLookupField('rpr001', 'Lookup', 'lookup_col')._unsafeUnwrap();
      const table = createTableAggregate(tableName, field);
      const checker = createSchemaChecker({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const checkResults = await collectFinalResults(
        checker.checkField(table, field.id().toString())
      );
      const ruleId = checkResults.find(
        (result) =>
          result.ruleId ===
          `reference:${field.id().toString()}:${createValidFieldId('lookup_rpr001')}`
      )?.ruleId;

      expect(ruleId).toBeDefined();

      const repairer = createSchemaRepairer({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });
      const repairResults = await collectFinalRepairResults(
        repairer.repairRule(table, field.id().toString(), ruleId!)
      );

      expect(repairResults).toHaveLength(1);
      expect(repairResults[0].status).toBe('success');
      expect(repairResults[0].outcome).toBe('repaired');
      expect(repairResults[0].ruleId).toBe(ruleId);

      const repairedCheckResults = await collectFinalResults(
        checker.checkField(table, field.id().toString())
      );
      const repairedRule = repairedCheckResults.find((result) => result.ruleId === ruleId);
      expect(repairedRule?.status).toBe('success');
    });
  });
});
