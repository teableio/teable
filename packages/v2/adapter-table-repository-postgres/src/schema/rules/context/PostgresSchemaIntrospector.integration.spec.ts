/**
 * Integration tests for PostgresSchemaIntrospector.
 *
 * These tests verify that the introspector correctly queries PostgreSQL
 * information_schema and pg_catalog to introspect database state.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PostgresSchemaIntrospector } from './PostgresSchemaIntrospector';

const TEST_SCHEMA = 'test_introspector';

describe('PostgresSchemaIntrospector Integration Tests', () => {
  let pgContainer: StartedPostgreSqlContainer;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: Kysely<any>;
  let introspector: PostgresSchemaIntrospector;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('teable_introspector_test')
      .withUsername('test')
      .withPassword('test')
      .start();

    const pool = new Pool({
      connectionString: pgContainer.getConnectionUri(),
    });

    db = new Kysely({
      dialect: new PostgresDialect({ pool }),
    });

    introspector = new PostgresSchemaIntrospector(db);

    // Create test schema
    await sql`CREATE SCHEMA IF NOT EXISTS ${sql.id(TEST_SCHEMA)}`.execute(db);
  }, 60000);

  afterAll(async () => {
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

  // ============================================================
  // tableExists tests
  // ============================================================
  describe('tableExists', () => {
    it('returns false when table does not exist', async () => {
      const result = await introspector.tableExists(TEST_SCHEMA, 'nonexistent_table');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(false);
    });

    it('returns true when table exists', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (__id TEXT PRIMARY KEY)`.execute(db);

      const result = await introspector.tableExists(TEST_SCHEMA, 'test_table');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(true);
    });

    it('uses public schema when schema is null', async () => {
      await sql`CREATE TABLE test_public_table (__id TEXT PRIMARY KEY)`.execute(db);

      try {
        const result = await introspector.tableExists(null, 'test_public_table');
        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toBe(true);
      } finally {
        await sql`DROP TABLE IF EXISTS test_public_table`.execute(db);
      }
    });
  });

  // ============================================================
  // columnExists tests
  // ============================================================
  describe('columnExists', () => {
    it('returns false when column does not exist', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (__id TEXT PRIMARY KEY)`.execute(db);

      const result = await introspector.columnExists(TEST_SCHEMA, 'test_table', 'nonexistent_col');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(false);
    });

    it('returns true when column exists', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (__id TEXT PRIMARY KEY, my_column TEXT)`.execute(
        db
      );

      const result = await introspector.columnExists(TEST_SCHEMA, 'test_table', 'my_column');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(true);
    });

    it('returns false when table does not exist', async () => {
      const result = await introspector.columnExists(TEST_SCHEMA, 'nonexistent_table', 'any_col');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(false);
    });
  });

  // ============================================================
  // getColumn tests
  // ============================================================
  describe('getColumn', () => {
    it('returns null when column does not exist', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (__id TEXT PRIMARY KEY)`.execute(db);

      const result = await introspector.getColumn(TEST_SCHEMA, 'test_table', 'nonexistent_col');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });

    it('returns column info for nullable TEXT column', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (
        __id TEXT PRIMARY KEY,
        my_text_column TEXT
      )`.execute(db);

      const result = await introspector.getColumn(TEST_SCHEMA, 'test_table', 'my_text_column');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toMatchSnapshot('nullable TEXT column');
    });

    it('returns column info for NOT NULL column', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (
        __id TEXT PRIMARY KEY,
        required_col TEXT NOT NULL
      )`.execute(db);

      const result = await introspector.getColumn(TEST_SCHEMA, 'test_table', 'required_col');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toMatchSnapshot('NOT NULL TEXT column');
    });

    it('returns column info for INTEGER column', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (
        __id TEXT PRIMARY KEY,
        int_col INTEGER
      )`.execute(db);

      const result = await introspector.getColumn(TEST_SCHEMA, 'test_table', 'int_col');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toMatchSnapshot('INTEGER column');
    });

    it('returns column info for DOUBLE PRECISION column', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (
        __id TEXT PRIMARY KEY,
        float_col DOUBLE PRECISION
      )`.execute(db);

      const result = await introspector.getColumn(TEST_SCHEMA, 'test_table', 'float_col');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toMatchSnapshot('DOUBLE PRECISION column');
    });

    it('returns column info for TIMESTAMP column', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (
        __id TEXT PRIMARY KEY,
        ts_col TIMESTAMP WITH TIME ZONE
      )`.execute(db);

      const result = await introspector.getColumn(TEST_SCHEMA, 'test_table', 'ts_col');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toMatchSnapshot('TIMESTAMP WITH TIME ZONE column');
    });

    it('returns column info for BOOLEAN column', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (
        __id TEXT PRIMARY KEY,
        bool_col BOOLEAN NOT NULL DEFAULT false
      )`.execute(db);

      const result = await introspector.getColumn(TEST_SCHEMA, 'test_table', 'bool_col');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toMatchSnapshot('BOOLEAN NOT NULL column');
    });

    it('returns column info for JSONB column', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (
        __id TEXT PRIMARY KEY,
        json_col JSONB
      )`.execute(db);

      const result = await introspector.getColumn(TEST_SCHEMA, 'test_table', 'json_col');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toMatchSnapshot('JSONB column');
    });

    it('returns column info for generated column', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (
        __id TEXT PRIMARY KEY,
        first_name TEXT,
        last_name TEXT,
        full_name TEXT GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED
      )`.execute(db);

      const result = await introspector.getColumn(TEST_SCHEMA, 'test_table', 'full_name');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toMatchSnapshot('generated column');
    });
  });

  // ============================================================
  // indexExists tests
  // ============================================================
  describe('indexExists', () => {
    it('returns false when index does not exist', async () => {
      const result = await introspector.indexExists(TEST_SCHEMA, 'nonexistent_index');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(false);
    });

    it('returns true when index exists', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (
        __id TEXT PRIMARY KEY,
        my_col TEXT
      )`.execute(db);
      await sql`CREATE INDEX idx_my_col ON ${sql.id(TEST_SCHEMA)}.test_table (my_col)`.execute(db);

      const result = await introspector.indexExists(TEST_SCHEMA, 'idx_my_col');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(true);
    });

    it('returns true for unique index', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (
        __id TEXT PRIMARY KEY,
        unique_col TEXT
      )`.execute(db);
      await sql`CREATE UNIQUE INDEX idx_unique_col ON ${sql.id(TEST_SCHEMA)}.test_table (unique_col)`.execute(
        db
      );

      const result = await introspector.indexExists(TEST_SCHEMA, 'idx_unique_col');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(true);
    });
  });

  // ============================================================
  // getIndex tests
  // ============================================================
  describe('getIndex', () => {
    it('returns null when index does not exist', async () => {
      const result = await introspector.getIndex(TEST_SCHEMA, 'nonexistent_index');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });

    it('returns index info for single-column index', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (
        __id TEXT PRIMARY KEY,
        my_col TEXT
      )`.execute(db);
      await sql`CREATE INDEX idx_single ON ${sql.id(TEST_SCHEMA)}.test_table (my_col)`.execute(db);

      const result = await introspector.getIndex(TEST_SCHEMA, 'idx_single');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toMatchSnapshot('single-column index');
    });

    it('returns index info for multi-column index', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (
        __id TEXT PRIMARY KEY,
        col_a TEXT,
        col_b TEXT,
        col_c TEXT
      )`.execute(db);
      await sql`CREATE INDEX idx_multi ON ${sql.id(TEST_SCHEMA)}.test_table (col_a, col_b, col_c)`.execute(
        db
      );

      const result = await introspector.getIndex(TEST_SCHEMA, 'idx_multi');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toMatchSnapshot('multi-column index');
    });

    it('returns index info for unique index', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (
        __id TEXT PRIMARY KEY,
        unique_col TEXT
      )`.execute(db);
      await sql`CREATE UNIQUE INDEX idx_unique ON ${sql.id(TEST_SCHEMA)}.test_table (unique_col)`.execute(
        db
      );

      const result = await introspector.getIndex(TEST_SCHEMA, 'idx_unique');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toMatchSnapshot('unique index');
    });
  });

  // ============================================================
  // constraintExists tests
  // ============================================================
  describe('constraintExists', () => {
    it('returns false when constraint does not exist', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (__id TEXT PRIMARY KEY)`.execute(db);

      const result = await introspector.constraintExists(
        TEST_SCHEMA,
        'test_table',
        'nonexistent_constraint'
      );

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(false);
    });

    it('returns true for PRIMARY KEY constraint', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (
        __id TEXT CONSTRAINT pk_test_table PRIMARY KEY
      )`.execute(db);

      const result = await introspector.constraintExists(
        TEST_SCHEMA,
        'test_table',
        'pk_test_table'
      );

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(true);
    });

    it('returns true for UNIQUE constraint', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (
        __id TEXT PRIMARY KEY,
        unique_col TEXT CONSTRAINT uq_unique_col UNIQUE
      )`.execute(db);

      const result = await introspector.constraintExists(
        TEST_SCHEMA,
        'test_table',
        'uq_unique_col'
      );

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(true);
    });

    it('returns true for CHECK constraint', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (
        __id TEXT PRIMARY KEY,
        status TEXT CONSTRAINT ck_status CHECK (status IN ('active', 'inactive'))
      )`.execute(db);

      const result = await introspector.constraintExists(TEST_SCHEMA, 'test_table', 'ck_status');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(true);
    });
  });

  // ============================================================
  // foreignKeyExists tests
  // ============================================================
  describe('foreignKeyExists', () => {
    it('returns false when foreign key does not exist', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (__id TEXT PRIMARY KEY)`.execute(db);

      const result = await introspector.foreignKeyExists(
        TEST_SCHEMA,
        'test_table',
        'nonexistent_fk'
      );

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(false);
    });

    it('returns true when foreign key exists', async () => {
      // Create parent table
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.parent_table (
        __id TEXT PRIMARY KEY
      )`.execute(db);

      // Create child table with FK
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.child_table (
        __id TEXT PRIMARY KEY,
        parent_id TEXT,
        CONSTRAINT fk_parent FOREIGN KEY (parent_id) REFERENCES ${sql.id(TEST_SCHEMA)}.parent_table(__id)
      )`.execute(db);

      const result = await introspector.foreignKeyExists(TEST_SCHEMA, 'child_table', 'fk_parent');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(true);
    });
  });

  // ============================================================
  // getForeignKey tests
  // ============================================================
  describe('getForeignKey', () => {
    it('returns null when foreign key does not exist', async () => {
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.test_table (__id TEXT PRIMARY KEY)`.execute(db);

      const result = await introspector.getForeignKey(TEST_SCHEMA, 'test_table', 'nonexistent_fk');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });

    it('returns foreign key info for simple FK', async () => {
      // Create parent table
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.users (
        __id TEXT PRIMARY KEY
      )`.execute(db);

      // Create child table with FK
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.orders (
        __id TEXT PRIMARY KEY,
        user_id TEXT,
        CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES ${sql.id(TEST_SCHEMA)}.users(__id)
      )`.execute(db);

      const result = await introspector.getForeignKey(TEST_SCHEMA, 'orders', 'fk_user');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toMatchSnapshot('simple foreign key');
    });

    it('returns foreign key info for FK with custom column names', async () => {
      // Create parent table with non-standard PK name
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.categories (
        category_code TEXT PRIMARY KEY
      )`.execute(db);

      // Create child table with FK referencing non-standard column
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.products (
        __id TEXT PRIMARY KEY,
        cat_ref TEXT,
        CONSTRAINT fk_category FOREIGN KEY (cat_ref) REFERENCES ${sql.id(TEST_SCHEMA)}.categories(category_code)
      )`.execute(db);

      const result = await introspector.getForeignKey(TEST_SCHEMA, 'products', 'fk_category');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toMatchSnapshot('foreign key with custom column names');
    });
  });

  // ============================================================
  // Error handling tests
  // ============================================================
  describe('error handling', () => {
    it('wraps database errors in domain error with proper code', async () => {
      // Test error handling by checking the error structure
      // The introspector should return err() with proper error code on failures

      // Create an introspector with an invalid connection string
      // This tests the error wrapping behavior
      const invalidPool = new Pool({
        host: 'nonexistent-host-that-does-not-exist.local',
        port: 5432,
        user: 'test',
        password: 'test',
        database: 'test',
        connectionTimeoutMillis: 100, // Short timeout for fast failure
      });
      const invalidDb = new Kysely({
        dialect: new PostgresDialect({ pool: invalidPool }),
      });
      const invalidIntrospector = new PostgresSchemaIntrospector(invalidDb);

      try {
        const result = await invalidIntrospector.tableExists(TEST_SCHEMA, 'any_table');

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.code).toBe('schema.introspection_failed');
        }
      } finally {
        await invalidDb.destroy().catch(() => {
          // Ignore cleanup errors
        });
      }
    });
  });

  // ============================================================
  // Schema isolation tests
  // ============================================================
  describe('schema isolation', () => {
    it('does not find table from different schema', async () => {
      // Create table in test schema
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.my_table (__id TEXT PRIMARY KEY)`.execute(db);

      // Should not find it in public schema
      const result = await introspector.tableExists('public', 'my_table');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(false);
    });

    it('does not find column from different schema', async () => {
      // Create table with column in test schema
      await sql`CREATE TABLE ${sql.id(TEST_SCHEMA)}.my_table (
        __id TEXT PRIMARY KEY,
        my_col TEXT
      )`.execute(db);

      // Should not find column in public schema
      const result = await introspector.columnExists('public', 'my_table', 'my_col');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(false);
    });
  });
});
