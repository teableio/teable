/**
 * Integration tests for FieldTypeConversionVisitor using PGlite.
 *
 * These tests validate that the generated SQL statements actually work
 * against a real PostgreSQL-compatible database using PGlite.
 */
import type { Field } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Kysely, sql } from 'kysely';
import { describe, expect, it } from 'vitest';

import { executeTableSchemaStatements } from '../../../shared/db';
import { FieldTypeConversionVisitorFactory } from '../FieldTypeConversionVisitor';
import { createPGliteDb } from './helpers/createPGliteDb';
import { createTextField, createUsrField } from './helpers/fieldFactories';

describe('FieldTypeConversionVisitor (PGlite)', () => {
  const DB_FIELD_NAME = 'user_text';

  const executeConversion = async (
    dataDb: Kysely<V1TeableDatabase>,
    metaDb: Kysely<V1TeableDatabase>,
    sourceField: Field,
    targetField: Field
  ) => {
    const factory = new FieldTypeConversionVisitorFactory({
      db: dataDb,
      schema: null,
      tableName: 'records',
      tableId: 'tblTestTable0000001',
      dbFieldName: DB_FIELD_NAME,
    });
    const visitorResult = sourceField.accept(factory);
    expect(visitorResult.isOk()).toBe(true);
    const statementsResult = targetField.accept(visitorResult._unsafeUnwrap());
    expect(statementsResult.isOk()).toBe(true);
    await executeTableSchemaStatements(dataDb, statementsResult._unsafeUnwrap(), {
      dataDb,
      metaDb,
      enforceRelationAccess: true,
    });
  };

  describe('Text to Number', () => {
    it.todo(
      'should convert valid numeric strings to numbers'
      // Setup: Create table with text column, insert '42', '3.14', '-10'
      // Execute: Run conversion SQL
      // Verify: Column is double precision, values are 42, 3.14, -10
    );

    it.todo(
      'should set invalid numeric strings to NULL'
      // Setup: Create table with text column, insert 'abc', 'not a number', '12.34.56'
      // Execute: Run conversion SQL
      // Verify: Column is double precision, values are NULL
    );

    it.todo(
      'should preserve NULL values'
      // Setup: Create table with text column, insert NULL
      // Execute: Run conversion SQL
      // Verify: Value remains NULL
    );

    it.todo(
      'should handle empty strings as NULL'
      // Setup: Create table with text column, insert ''
      // Execute: Run conversion SQL
      // Verify: Value becomes NULL (or stays based on implementation)
    );
  });

  describe('Text to Checkbox', () => {
    it.todo(
      "should convert 'true', '1', 'yes', 'on' to TRUE"
      // Setup: Insert various truthy strings
      // Execute: Run conversion SQL
      // Verify: All values are TRUE
    );

    it.todo(
      "should convert 'false', '0', 'no', 'off' to FALSE"
      // Setup: Insert various falsy strings
      // Execute: Run conversion SQL
      // Verify: All values are FALSE
    );

    it.todo(
      'should handle case-insensitive matching'
      // Setup: Insert 'TRUE', 'True', 'FALSE', 'False'
      // Execute: Run conversion SQL
      // Verify: Correct boolean values
    );

    it.todo(
      'should set unrecognized strings to NULL'
      // Setup: Insert 'maybe', 'unknown', 'abc'
      // Execute: Run conversion SQL
      // Verify: All values are NULL
    );
  });

  describe('Text to Date', () => {
    it.todo(
      'should convert ISO date strings to timestamptz'
      // Setup: Insert '2025-01-15', '2025-01-15T10:30:00Z'
      // Execute: Run conversion SQL
      // Verify: Column is timestamptz, values are parsed correctly
    );

    it.todo(
      'should set invalid date strings to NULL'
      // Setup: Insert 'not a date', '2025-13-45', 'yesterday'
      // Execute: Run conversion SQL
      // Verify: Values are NULL
    );

    it.todo(
      'should handle various date formats'
      // Setup: Insert '2025-01-15', '2025-01-15T10:30:00.000Z', '2025-01-15 10:30:00+00'
      // Execute: Run conversion SQL
      // Verify: All parsed as dates
    );
  });

  describe('Text to User', () => {
    it('should resolve matching text via meta DB and clear non-matching text', async () => {
      const { db: dataDb } = await createPGliteDb();
      const { db: metaDb } = await createPGliteDb();
      try {
        await sql`CREATE TABLE records (__id text PRIMARY KEY, user_text text)`.execute(dataDb);
        await sql`
          INSERT INTO records (__id, user_text)
          VALUES
            ('rec_email', 'alice@example.com'),
            ('rec_name', 'Bob'),
            ('rec_missing', 'random text value')
        `.execute(dataDb);
        await sql`CREATE TABLE users (id text PRIMARY KEY, name text NOT NULL, email text)`.execute(
          metaDb
        );
        await sql`
          INSERT INTO users (id, name, email)
          VALUES
            ('usr_alice', 'Alice', 'alice@example.com'),
            ('usr_bob', 'Bob', NULL)
        `.execute(metaDb);

        await executeConversion(
          dataDb,
          metaDb,
          createTextField('srcText', 'Source Text', DB_FIELD_NAME)._unsafeUnwrap(),
          createUsrField('tgtUsr', 'Target User', DB_FIELD_NAME, false)._unsafeUnwrap()
        );

        const rows = await sql<{ __id: string; user_text: unknown | null }>`
          SELECT __id, user_text
          FROM records
          ORDER BY __id
        `.execute(dataDb);

        expect(rows.rows).toEqual([
          {
            __id: 'rec_email',
            user_text: {
              id: 'usr_alice',
              title: 'Alice',
              email: 'alice@example.com',
              avatarUrl: '/api/attachments/read/public/avatar/usr_alice',
            },
          },
          { __id: 'rec_missing', user_text: null },
          {
            __id: 'rec_name',
            user_text: {
              id: 'usr_bob',
              title: 'Bob',
              email: null,
              avatarUrl: '/api/attachments/read/public/avatar/usr_bob',
            },
          },
        ]);
      } finally {
        await dataDb.destroy();
        await metaDb.destroy();
      }
    });

    it('should create array format for multiple user field', async () => {
      const { db: dataDb } = await createPGliteDb();
      const { db: metaDb } = await createPGliteDb();
      try {
        await sql`CREATE TABLE records (__id text PRIMARY KEY, user_text text)`.execute(dataDb);
        await sql`INSERT INTO records (__id, user_text) VALUES ('rec_multi', 'Alice, Bob')`.execute(
          dataDb
        );
        await sql`CREATE TABLE users (id text PRIMARY KEY, name text NOT NULL, email text)`.execute(
          metaDb
        );
        await sql`
          INSERT INTO users (id, name, email)
          VALUES
            ('usr_alice', 'Alice', 'alice@example.com'),
            ('usr_bob', 'Bob', NULL)
        `.execute(metaDb);

        await executeConversion(
          dataDb,
          metaDb,
          createTextField('srcText', 'Source Text', DB_FIELD_NAME)._unsafeUnwrap(),
          createUsrField('tgtUsr', 'Target User', DB_FIELD_NAME, true)._unsafeUnwrap()
        );

        const rows = await sql<{ user_text: unknown }>`
          SELECT user_text
          FROM records
          WHERE __id = 'rec_multi'
        `.execute(dataDb);

        expect(rows.rows[0]?.user_text).toEqual([
          {
            id: 'usr_alice',
            title: 'Alice',
            email: 'alice@example.com',
            avatarUrl: '/api/attachments/read/public/avatar/usr_alice',
          },
          {
            id: 'usr_bob',
            title: 'Bob',
            email: null,
            avatarUrl: '/api/attachments/read/public/avatar/usr_bob',
          },
        ]);
      } finally {
        await dataDb.destroy();
        await metaDb.destroy();
      }
    });

    it.todo(
      'should match text against user email'
      // Setup: Create users table with test user, insert user email as text
      // Execute: Run conversion SQL
      // Verify: User object is created with correct id, title, email
    );

    it.todo(
      'should match text against user name'
      // Setup: Create users table with test user, insert user name as text
      // Execute: Run conversion SQL
      // Verify: User object is created
    );

    it.todo(
      'should set non-matching text to NULL'
      // Setup: Create users table, insert text that matches no user
      // Execute: Run conversion SQL
      // Verify: Value is NULL
    );

    it.todo(
      'should create array format for multiple user field'
      // Setup: Create users table, insert matching text
      // Execute: Run conversion SQL with isMultiple=true
      // Verify: Result is JSON array containing user object
    );
  });

  describe('Number to Date', () => {
    it.todo(
      'should convert Unix timestamp (milliseconds) to timestamptz'
      // Setup: Insert 1705315200000 (2024-01-15T12:00:00Z)
      // Execute: Run conversion SQL
      // Verify: Column is timestamptz, value is correct datetime
    );

    it.todo(
      'should handle NULL values'
      // Setup: Insert NULL
      // Execute: Run conversion SQL
      // Verify: Value remains NULL
    );

    it.todo(
      'should handle zero timestamp'
      // Setup: Insert 0 (1970-01-01T00:00:00Z)
      // Execute: Run conversion SQL
      // Verify: Value is epoch
    );
  });

  describe('Checkbox to Number/Rating', () => {
    it.todo(
      'should convert TRUE to 1 for number field'
      // Setup: Insert TRUE
      // Execute: Run conversion SQL
      // Verify: Value is 1
    );

    it.todo(
      'should convert FALSE to 0 for number field'
      // Setup: Insert FALSE
      // Execute: Run conversion SQL
      // Verify: Value is 0
    );

    it.todo(
      'should convert TRUE to max rating for rating field'
      // Setup: Insert TRUE, rating max = 5
      // Execute: Run conversion SQL
      // Verify: Value is 5
    );

    it.todo(
      'should convert FALSE to 0 for rating field'
      // Setup: Insert FALSE
      // Execute: Run conversion SQL
      // Verify: Value is 0
    );
  });

  describe('MultipleSelect conversions', () => {
    it.todo(
      'should join array elements with comma for text conversion'
      // Setup: Insert '["a", "b", "c"]' jsonb
      // Execute: Run conversion SQL
      // Verify: Value is 'a, b, c'
    );

    it.todo(
      'should extract first element for singleSelect conversion'
      // Setup: Insert '["first", "second", "third"]' jsonb
      // Execute: Run conversion SQL
      // Verify: Value is 'first'
    );

    it.todo(
      'should handle empty array'
      // Setup: Insert '[]' jsonb
      // Execute: Run conversion SQL
      // Verify: Value is NULL for singleSelect, empty string for text
    );

    it.todo(
      'should handle single element array'
      // Setup: Insert '["only"]' jsonb
      // Execute: Run conversion SQL for text
      // Verify: Value is 'only'
    );
  });

  describe('User multiplicity changes', () => {
    it.todo(
      'should wrap single user object in array (single -> multiple)'
      // Setup: Insert {"id": "usr1", "title": "User", "email": "user@test.com"}
      // Execute: Run conversion SQL for single -> multiple
      // Verify: Value is [{"id": "usr1", ...}]
    );

    it.todo(
      'should extract first user from array (multiple -> single)'
      // Setup: Insert [{"id": "usr1", ...}, {"id": "usr2", ...}]
      // Execute: Run conversion SQL for multiple -> single
      // Verify: Value is {"id": "usr1", ...}
    );

    it.todo(
      'should preserve format if already correct (single stays single)'
      // Setup: Insert {"id": "usr1", ...}
      // Execute: Run conversion SQL for single -> single
      // Verify: Value unchanged
    );

    it.todo(
      'should preserve format if already correct (multiple stays multiple)'
      // Setup: Insert [{"id": "usr1", ...}]
      // Execute: Run conversion SQL for multiple -> multiple
      // Verify: Value unchanged
    );

    it.todo(
      'should handle empty array for multiple -> single'
      // Setup: Insert '[]'
      // Execute: Run conversion SQL
      // Verify: Value is NULL
    );
  });

  describe('Edge cases', () => {
    it.todo(
      'should handle empty table (no records)'
      // Setup: Create table with no records
      // Execute: Run conversion SQL
      // Verify: No errors, table structure changed
    );

    it.todo(
      'should handle large batch of records'
      // Setup: Insert 1000+ records
      // Execute: Run conversion SQL
      // Verify: All records converted correctly
    );

    it.todo(
      'should handle special characters in text values'
      // Setup: Insert "O'Brien", "Test \"quoted\"", "Line\nBreak"
      // Execute: Run conversion SQL
      // Verify: Values preserved/converted correctly
    );

    it.todo(
      'should handle Unicode characters'
      // Setup: Insert '日本語', '🎉', 'émojis'
      // Execute: Run conversion SQL
      // Verify: Values preserved
    );

    it.todo(
      'should handle very long text values'
      // Setup: Insert text with 10000+ characters
      // Execute: Run conversion SQL
      // Verify: Value preserved or truncated as expected
    );

    it.todo(
      'should handle mixed NULL and non-NULL values in same column'
      // Setup: Insert mix of NULL and valid values
      // Execute: Run conversion SQL
      // Verify: NULLs stay NULL, others converted
    );
  });

  describe('Select options generation', () => {
    it.todo(
      'should create options from distinct text values'
      // Setup: Create field table, insert records with text values 'a', 'b', 'a'
      // Execute: Run options generation SQL
      // Verify: Field options contain 'a' and 'b' (no duplicates)
    );

    it.todo(
      'should not duplicate existing options'
      // Setup: Field already has option 'a', insert records with 'a', 'b'
      // Execute: Run options generation SQL
      // Verify: Only 'b' added as new option
    );

    it.todo(
      'should generate unique IDs for each option'
      // Setup: Insert multiple distinct values
      // Execute: Run options generation SQL
      // Verify: Each option has unique 'cho' prefixed ID
    );

    it.todo(
      'should assign colors from palette'
      // Setup: Insert values
      // Execute: Run options generation SQL
      // Verify: Colors are from the defined palette
    );

    it.todo(
      'should skip empty strings'
      // Setup: Insert '', 'a', ''
      // Execute: Run options generation SQL
      // Verify: Only 'a' added as option
    );
  });
});
