/**
 * Integration tests for Schema Rules using a real PostgreSQL database.
 *
 * These tests verify that:
 * 1. isValid() correctly detects missing schema elements
 * 2. up() creates the expected schema elements
 * 3. down() removes the schema elements
 * 4. isValid() and up() are consistent
 */
import type { DomainError, Field, LinkField } from '@teable/v2-core';
import {
  createSingleLineTextField,
  DbFieldName,
  FieldId,
  FieldName,
  FieldNotNull,
  FieldUnique,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PostgresSchemaIntrospector } from '../context/PostgresSchemaIntrospector';
import type { SchemaIntrospector } from '../context/SchemaIntrospector';
import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import { ColumnExistsRule } from './ColumnExistsRule';
import { FkColumnRule } from './FkColumnRule';
import { ForeignKeyRule } from './ForeignKeyRule';
import { IndexRule } from './IndexRule';
import type { JunctionTableConfig } from './JunctionTableRule';
import { JunctionTableExistsRule } from './JunctionTableRule';
import { NotNullConstraintRule } from './NotNullConstraintRule';
import { OrderColumnRule } from './OrderColumnRule';
import { UniqueIndexRule } from './UniqueIndexRule';

const TEST_SCHEMA = 'test_schema_rules';

/**
 * Create a valid field ID (format: fld + 16 chars)
 */
const createValidFieldId = (seed: string): string => `fld${seed.padEnd(16, '0').slice(0, 16)}`;

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

/**
 * Create a mock LinkField for junction table tests.
 * Since creating a real LinkField is complex, we create a minimal mock.
 */
const createMockLinkField = (id: string, name: string): LinkField => {
  return {
    id: () => ({ toString: () => createValidFieldId(id) }),
    name: () => ({ toString: () => name }),
    relationship: () => ({ toString: () => 'manyMany' }),
    isOneWay: () => false,
  } as unknown as LinkField;
};

describe('Schema Rules Integration Tests', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let db: Kysely<V1TeableDatabase>;
  let introspector: SchemaIntrospector;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('teable_schema_rules_test')
      .withUsername('test')
      .withPassword('test')
      .start();

    const pool = new Pool({
      connectionString: pgContainer.getConnectionUri(),
    });

    db = new Kysely<V1TeableDatabase>({
      dialect: new PostgresDialect({ pool }),
    });

    introspector = new PostgresSchemaIntrospector(db);

    // Create test schema
    await sql`CREATE SCHEMA IF NOT EXISTS ${sql.id(TEST_SCHEMA)}`.execute(db);
  }, 60000); // 60s timeout for container startup

  afterAll(async () => {
    // Cleanup
    await sql`DROP SCHEMA IF EXISTS ${sql.id(TEST_SCHEMA)} CASCADE`.execute(db);
    await db.destroy();
    await pgContainer.stop();
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

  describe('ColumnExistsRule', () => {
    const TABLE_NAME = 'test_column_rule';

    it('should return invalid when column does not exist', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('fld001', 'Name', 'name_col');
      expect(fieldResult.isOk()).toBe(true);
      const field = fieldResult._unsafeUnwrap();

      const rule = new ColumnExistsRule(field);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().missing?.length).toBeGreaterThan(0);
    });

    it('should return valid when column exists', async () => {
      await createTestTable(TABLE_NAME, ['name_col TEXT']);

      const fieldResult = createRealField('fld001', 'Name', 'name_col');
      expect(fieldResult.isOk()).toBe(true);
      const field = fieldResult._unsafeUnwrap();

      const rule = new ColumnExistsRule(field);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(true);
    });

    it('should create column with up() and validate it exists', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('fld001', 'Name', 'name_col');
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

      const fieldResult = createRealField('fld001', 'Name', 'name_col');
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
  });

  describe('NotNullConstraintRule', () => {
    const TABLE_NAME = 'test_not_null_rule';

    it('should detect missing NOT NULL constraint', async () => {
      // Create column without NOT NULL
      await createTestTable(TABLE_NAME, ['name_col TEXT']);

      const fieldResult = createRealField('fld001', 'Name', 'name_col', { notNull: true });
      expect(fieldResult.isOk()).toBe(true);
      const field = fieldResult._unsafeUnwrap();

      const columnRule = new ColumnExistsRule(field);
      const rule = new NotNullConstraintRule(field, columnRule);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      // Column exists but missing NOT NULL constraint
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().missing?.some((m) => m.includes('NOT NULL'))).toBe(true);
    });

    it('should return valid when NOT NULL constraint exists', async () => {
      // Create column with NOT NULL
      await createTestTable(TABLE_NAME, ['name_col TEXT NOT NULL']);

      const fieldResult = createRealField('fld001', 'Name', 'name_col', { notNull: true });
      expect(fieldResult.isOk()).toBe(true);
      const field = fieldResult._unsafeUnwrap();

      const columnRule = new ColumnExistsRule(field);
      const rule = new NotNullConstraintRule(field, columnRule);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(true);
    });
  });

  describe('IndexRule', () => {
    const TABLE_NAME = 'test_index_rule';

    it('should return invalid when index does not exist', async () => {
      await createTestTable(TABLE_NAME, ['name_col TEXT']);

      const fieldResult = createRealField('fld001', 'Name', 'name_col');
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

      const fieldResult = createRealField('fld001', 'Name', 'name_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'name_col', 'other_table');
      const rule = IndexRule.forFkColumn(field, 'name_col', fkColumnRule);
      const ctx = createContext(TABLE_NAME, field);

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

    it('should drop index with down()', async () => {
      await createTestTable(TABLE_NAME, ['name_col TEXT']);
      await sql
        .raw(`CREATE INDEX index_name_col ON ${TEST_SCHEMA}.${TABLE_NAME}(name_col)`)
        .execute(db);

      const fieldResult = createRealField('fld001', 'Name', 'name_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'name_col', 'other_table');
      const rule = IndexRule.forFkColumn(field, 'name_col', fkColumnRule);
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
  });

  describe('UniqueIndexRule', () => {
    const TABLE_NAME = 'test_unique_index_rule';

    it('should return invalid when index does not exist', async () => {
      await createTestTable(TABLE_NAME, ['email_col TEXT']);

      const fieldResult = createRealField('fld001', 'Email', 'email_col');
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
      // Create a non-unique index
      await sql
        .raw(`CREATE INDEX index_email_col ON ${TEST_SCHEMA}.${TABLE_NAME}(email_col)`)
        .execute(db);

      const fieldResult = createRealField('fld001', 'Email', 'email_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'email_col', 'other_table');
      const rule = UniqueIndexRule.forFkColumn(field, 'email_col', fkColumnRule);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().missing?.some((m) => m.includes('not unique'))).toBe(true);
    });

    it('should return valid when unique index exists', async () => {
      await createTestTable(TABLE_NAME, ['email_col TEXT']);
      await sql
        .raw(`CREATE UNIQUE INDEX index_email_col ON ${TEST_SCHEMA}.${TABLE_NAME}(email_col)`)
        .execute(db);

      const fieldResult = createRealField('fld001', 'Email', 'email_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'email_col', 'other_table');
      const rule = UniqueIndexRule.forFkColumn(field, 'email_col', fkColumnRule);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(true);
    });

    it('should create unique index with up()', async () => {
      await createTestTable(TABLE_NAME, ['email_col TEXT']);

      const fieldResult = createRealField('fld001', 'Email', 'email_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'email_col', 'other_table');
      const rule = UniqueIndexRule.forFkColumn(field, 'email_col', fkColumnRule);
      const ctx = createContext(TABLE_NAME, field);

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
  });

  describe('FkColumnRule', () => {
    const TABLE_NAME = 'test_fk_column_rule';

    it('should return invalid when FK column does not exist', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('fld001', 'Link', 'fk_link');
      const field = fieldResult._unsafeUnwrap();

      const rule = FkColumnRule.forField(field, 'fk_link', 'target_table');
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('should create FK column with up() and validate it exists', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('fld001', 'Link', 'fk_link');
      const field = fieldResult._unsafeUnwrap();

      const rule = FkColumnRule.forField(field, 'fk_link', 'target_table');
      const ctx = createContext(TABLE_NAME, field);

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

    it('should drop FK column with down()', async () => {
      await createTestTable(TABLE_NAME, ['fk_link TEXT']);

      const fieldResult = createRealField('fld001', 'Link', 'fk_link');
      const field = fieldResult._unsafeUnwrap();

      const rule = FkColumnRule.forField(field, 'fk_link', 'target_table');
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
  });

  describe('ForeignKeyRule', () => {
    const SOURCE_TABLE = 'test_fk_source';
    const TARGET_TABLE = 'test_fk_target';

    it('should return invalid when FK constraint does not exist', async () => {
      await createTestTable(TARGET_TABLE);
      await createTestTable(SOURCE_TABLE, ['fk_col TEXT']);

      const fieldResult = createRealField('fld001', 'Link', 'fk_col');
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

      const fieldResult = createRealField('fld001', 'Link', 'fk_col');
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

    it('should drop FK constraint with down()', async () => {
      await createTestTable(TARGET_TABLE);
      await createTestTable(SOURCE_TABLE, ['fk_col TEXT']);
      await sql
        .raw(
          `ALTER TABLE ${TEST_SCHEMA}.${SOURCE_TABLE} ADD CONSTRAINT fk_fk_col FOREIGN KEY (fk_col) REFERENCES ${TEST_SCHEMA}.${TARGET_TABLE}(__id) ON DELETE CASCADE`
        )
        .execute(db);

      const fieldResult = createRealField('fld001', 'Link', 'fk_col');
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
  });

  describe('OrderColumnRule', () => {
    const TABLE_NAME = 'test_order_column_rule';

    it('should return invalid when order column does not exist', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('fld001', 'Link', 'link_col');
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

    it('should create order column with up()', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('fld001', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'link_col', 'target_table');
      const rule = OrderColumnRule.forField(
        field,
        'order_fld001',
        { schema: TEST_SCHEMA, tableName: TABLE_NAME },
        fkColumnRule
      );
      const ctx = createContext(TABLE_NAME, field);

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

    it('should drop order column with down()', async () => {
      await createTestTable(TABLE_NAME, ['order_fld001 DOUBLE PRECISION']);

      const fieldResult = createRealField('fld001', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'link_col', 'target_table');
      const rule = OrderColumnRule.forField(
        field,
        'order_fld001',
        { schema: TEST_SCHEMA, tableName: TABLE_NAME },
        fkColumnRule
      );
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

      const fieldResult = createRealField('fld001', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('fld001', 'Link');
      const rule = new JunctionTableExistsRule(linkField, createJunctionConfig());
      const ctx = createContext(SOURCE_TABLE, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().missing?.some((m) => m.includes('junction table'))).toBe(true);
    });

    it('should create junction table with all components using up()', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);

      const fieldResult = createRealField('fld001', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('fld001', 'Link');
      const rule = new JunctionTableExistsRule(linkField, createJunctionConfig());
      const ctx = createContext(SOURCE_TABLE, field);

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

    it('should detect missing column in junction table', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);
      // Create junction table without order column
      await sql
        .raw(
          `CREATE TABLE ${TEST_SCHEMA}.${JUNCTION_TABLE} (
            __id SERIAL PRIMARY KEY,
            self_key TEXT,
            foreign_key TEXT,
            UNIQUE(self_key, foreign_key)
          )`
        )
        .execute(db);

      const fieldResult = createRealField('fld001', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('fld001', 'Link');
      const rule = new JunctionTableExistsRule(linkField, createJunctionConfig());
      const ctx = createContext(SOURCE_TABLE, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().missing?.some((m) => m.includes('order_col'))).toBe(true);
    });

    it('should detect missing unique constraint in junction table', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);
      // Create junction table without unique constraint
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

      const fieldResult = createRealField('fld001', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('fld001', 'Link');
      const junctionRule = new JunctionTableExistsRule(linkField, createJunctionConfig());
      const rule = junctionRule.createUniqueConstraintRule();
      const ctx = createContext(SOURCE_TABLE, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().missing?.some((m) => m.includes('unique constraint'))).toBe(
        true
      );
    });

    it('should drop junction table with down()', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);

      const fieldResult = createRealField('fld001', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('fld001', 'Link');
      const rule = new JunctionTableExistsRule(linkField, createJunctionConfig());
      const ctx = createContext(SOURCE_TABLE, field);

      // First create it
      const upResult = rule.up(ctx);
      for (const stmt of upResult._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      // Verify it exists
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
  });
});
