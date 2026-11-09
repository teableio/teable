/**
 * Integration tests for FieldTypeConversionVisitor using PGlite.
 *
 * These tests validate that the generated SQL statements actually work
 * against a real PostgreSQL-compatible database using PGlite.
 */
import type { Field } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely, KyselyPlugin } from 'kysely';
import { PostgresQueryCompiler, sql } from 'kysely';
import { describe, expect, it } from 'vitest';

import { executeTableSchemaStatements } from '../../../shared/db';
import { FieldTypeConversionVisitorFactory } from '../FieldTypeConversionVisitor';
import { createPGliteDb } from './helpers/createPGliteDb';
import {
  createMultiSelField,
  createNumField,
  createTextField,
  createUsrField,
} from './helpers/fieldFactories';

describe('FieldTypeConversionVisitor (PGlite)', () => {
  const DB_FIELD_NAME = 'user_text';
  const TABLE_ID = 'tblTestTable0000001';
  const BASE_ID = 'bseTestBase00000001';
  const SPACE_ID = 'spcTestSpace0000001';

  const createUserLookupMetadata = async (metaDb: Kysely<V1TeableDatabase>) => {
    await sql`
      CREATE TABLE users (
        id text PRIMARY KEY,
        name text NOT NULL,
        email text,
        deleted_time timestamptz
      )
    `.execute(metaDb);
    await sql`CREATE TABLE base (id text PRIMARY KEY, space_id text NOT NULL)`.execute(metaDb);
    await sql`CREATE TABLE table_meta (id text PRIMARY KEY, base_id text NOT NULL)`.execute(metaDb);
    await sql`
      CREATE TABLE collaborator (
        id text PRIMARY KEY,
        resource_type text NOT NULL,
        resource_id text NOT NULL,
        principal_id text NOT NULL,
        principal_type text NOT NULL,
        created_time timestamptz NOT NULL DEFAULT now()
      )
    `.execute(metaDb);
    await sql`INSERT INTO base (id, space_id) VALUES (${BASE_ID}, ${SPACE_ID})`.execute(metaDb);
    await sql`INSERT INTO table_meta (id, base_id) VALUES (${TABLE_ID}, ${BASE_ID})`.execute(
      metaDb
    );
  };

  type QueryMetrics = {
    queryCount: number;
    profilePageQueryCount: number;
    alterToJsonbQueryCount: number;
    maxResultRows: number;
    maxResultStringLength: number;
    maxParameterStringLength: number;
  };

  const maxStringLength = (value: unknown): number => {
    if (typeof value === 'string') return value.length;
    if (Array.isArray(value)) {
      return value.reduce((max, item) => Math.max(max, maxStringLength(item)), 0);
    }
    if (value && typeof value === 'object') {
      return Object.values(value).reduce((max, item) => Math.max(max, maxStringLength(item)), 0);
    }
    return 0;
  };

  const observeDb = (
    db: Kysely<V1TeableDatabase>,
    options?: {
      throwOnProfilePage?: number;
      throwOnAlterToJsonb?: boolean;
      afterFirstProfilePage?: () => Promise<void>;
    }
  ): { db: Kysely<V1TeableDatabase>; metrics: QueryMetrics } => {
    const metrics: QueryMetrics = {
      queryCount: 0,
      profilePageQueryCount: 0,
      alterToJsonbQueryCount: 0,
      maxResultRows: 0,
      maxResultStringLength: 0,
      maxParameterStringLength: 0,
    };
    const compiler = new PostgresQueryCompiler();
    let firstProfileQueryId: unknown;
    const plugin = {
      transformQuery(args) {
        const compiled = compiler.compileQuery(args.node);
        metrics.queryCount += 1;
        metrics.maxParameterStringLength = Math.max(
          metrics.maxParameterStringLength,
          maxStringLength(compiled.parameters)
        );

        if (
          /\bfrom\s+pg_temp\.tmp_user_conversion_\w+_meta\b/i.test(compiled.sql) &&
          /\b(?:limit|fetch\s+first)\b/i.test(compiled.sql)
        ) {
          metrics.profilePageQueryCount += 1;
          if (metrics.profilePageQueryCount === 1 && options?.afterFirstProfilePage) {
            firstProfileQueryId = args.queryId;
          }
          if (metrics.profilePageQueryCount === options?.throwOnProfilePage) {
            throw new Error('injected metadata page failure');
          }
        }

        if (
          /^\s*alter\s+table\b.+\balter\s+column\s+"?user_text"?\s+type\s+jsonb/is.test(
            compiled.sql
          )
        ) {
          metrics.alterToJsonbQueryCount += 1;
          if (options?.throwOnAlterToJsonb) {
            throw new Error('injected final ALTER failure');
          }
        }
        return args.node;
      },
      async transformResult(args) {
        metrics.maxResultRows = Math.max(metrics.maxResultRows, args.result.rows.length);
        metrics.maxResultStringLength = Math.max(
          metrics.maxResultStringLength,
          maxStringLength(args.result.rows)
        );
        if (args.queryId === firstProfileQueryId) {
          firstProfileQueryId = undefined;
          await options?.afterFirstProfilePage?.();
        }
        return args.result;
      },
    } satisfies KyselyPlugin;
    return { db: db.withPlugin(plugin), metrics };
  };

  const buildConversionStatements = (
    dataDb: Kysely<V1TeableDatabase>,
    sourceField: Field,
    targetField: Field,
    options?: { tableName?: string; tableId?: string }
  ) => {
    const factory = new FieldTypeConversionVisitorFactory({
      db: dataDb,
      schema: null,
      tableName: options?.tableName ?? 'records',
      tableId: options?.tableId ?? TABLE_ID,
      dbFieldName: DB_FIELD_NAME,
    });
    const visitorResult = sourceField.accept(factory);
    expect(visitorResult.isOk()).toBe(true);
    const statementsResult = targetField.accept(visitorResult._unsafeUnwrap());
    expect(statementsResult.isOk()).toBe(true);
    return statementsResult._unsafeUnwrap();
  };

  const executeConversionOnHandle = async (
    dataDb: Kysely<V1TeableDatabase>,
    metaDb: Kysely<V1TeableDatabase>,
    sourceField: Field,
    targetField: Field
  ) => {
    const statements = buildConversionStatements(dataDb, sourceField, targetField);
    await executeTableSchemaStatements(dataDb, statements, {
      dataDb,
      metaDb,
      enforceRelationAccess: true,
    });
  };

  const executeConversion = async (
    dataDb: Kysely<V1TeableDatabase>,
    metaDb: Kysely<V1TeableDatabase>,
    sourceField: Field,
    targetField: Field
  ): Promise<void> => {
    const executeWithMetaTransaction = async (dataTransaction: Kysely<V1TeableDatabase>) => {
      if (metaDb.isTransaction) {
        await executeConversionOnHandle(dataTransaction, metaDb, sourceField, targetField);
      } else {
        await metaDb
          .transaction()
          .execute((metaTransaction) =>
            executeConversionOnHandle(dataTransaction, metaTransaction, sourceField, targetField)
          );
      }
    };
    if (dataDb.isTransaction) {
      await executeWithMetaTransaction(dataDb);
      return;
    }
    await dataDb.transaction().execute(executeWithMetaTransaction);
  };

  const insertPagedEligibleUsers = async (
    metaDb: Kysely<V1TeableDatabase>,
    options: { sameName: boolean }
  ): Promise<void> => {
    await createUserLookupMetadata(metaDb);
    if (options.sameName) {
      await sql`
        INSERT INTO users (id, name, email, deleted_time)
        SELECT
          'usr_' || lpad(value::text, 4, '0'),
          'Shared Name',
          'user-' || value::text || '@example.com',
          NULL
        FROM generate_series(1, 300) AS series(value)
      `.execute(metaDb);
    } else {
      await sql`
        INSERT INTO users (id, name, email, deleted_time)
        SELECT
          'usr_' || lpad(value::text, 4, '0'),
          'Profile ' || value::text,
          'user-' || value::text || '@example.com',
          NULL
        FROM generate_series(1, 300) AS series(value)
      `.execute(metaDb);
    }
    await sql`
      INSERT INTO collaborator (id, resource_type, resource_id, principal_id, principal_type)
      SELECT
        'col_' || lpad(value::text, 4, '0'),
        'base',
        ${BASE_ID},
        'usr_' || lpad(value::text, 4, '0'),
        'user'
      FROM generate_series(1, 300) AS series(value)
    `.execute(metaDb);
  };

  const expectTextColumn = async (dataDb: Kysely<V1TeableDatabase>): Promise<void> => {
    const result = await sql<{ data_type: string }>`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'records'
        AND column_name = ${DB_FIELD_NAME}
    `.execute(dataDb);
    expect(result.rows).toEqual([{ data_type: 'text' }]);
  };

  const expectNoTemporaryTables = async (dataDb: Kysely<V1TeableDatabase>): Promise<void> => {
    const result = await sql<{ relname: string }>`
      SELECT c.relname
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname LIKE 'pg_temp_%' AND c.relkind = 'r'
    `.execute(dataDb);
    expect(result.rows).toEqual([]);
  };

  describe('Text to Number', () => {
    it('converts currency, trailing digits, and percent text while keeping other invalid strings null', async () => {
      const { db: dataDb } = await createPGliteDb();
      const { db: metaDb } = await createPGliteDb();
      try {
        await sql`CREATE TABLE records (__id text PRIMARY KEY, user_text text)`.execute(dataDb);
        await sql`
          INSERT INTO records (__id, user_text)
          VALUES
            ('rec_currency', '$1,234'),
            ('rec_mixed', 'abc12'),
            ('rec_percent', '50%'),
            ('rec_plain', '45.67'),
            ('rec_negative', '-89'),
            ('rec_letters', 'abc'),
            ('rec_suffix', '12abc'),
            ('rec_scientific', '1e3'),
            ('rec_padded', ' 12 '),
            ('rec_empty', ''),
            ('rec_null', NULL)
        `.execute(dataDb);

        await executeConversion(
          dataDb,
          metaDb,
          createTextField('srcText', 'Source Text', DB_FIELD_NAME)._unsafeUnwrap(),
          createNumField('tgtNum', 'Target Number', DB_FIELD_NAME)._unsafeUnwrap()
        );

        const rows = await sql<{ __id: string; user_text: number | null }>`
          SELECT __id, user_text
          FROM records
          ORDER BY __id
        `.execute(dataDb);

        expect(rows.rows).toEqual([
          { __id: 'rec_currency', user_text: 1234 },
          { __id: 'rec_empty', user_text: null },
          { __id: 'rec_letters', user_text: null },
          { __id: 'rec_mixed', user_text: 12 },
          { __id: 'rec_negative', user_text: -89 },
          { __id: 'rec_null', user_text: null },
          { __id: 'rec_padded', user_text: null },
          { __id: 'rec_percent', user_text: 0.5 },
          { __id: 'rec_plain', user_text: 45.67 },
          { __id: 'rec_scientific', user_text: null },
          { __id: 'rec_suffix', user_text: null },
        ]);
      } finally {
        await dataDb.destroy();
        await metaDb.destroy();
      }
    });
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
    it('pages eligible profiles while preserving stable priority and duplicate token order', async () => {
      const { db: dataDb } = await createPGliteDb();
      const { db: metaDb } = await createPGliteDb();
      try {
        await insertPagedEligibleUsers(metaDb, { sameName: true });
        await sql`
          INSERT INTO users (id, name, email, deleted_time)
          VALUES
            ('aaa_email_collision', 'Email Collision', 'usr_0250', NULL),
            ('aaa_name_collision', 'usr_0250', 'name-collision@example.com', NULL),
            ('aaa_priority_name', 'priority@example.com', 'priority-name@example.com', NULL),
            ('usr_outsider', 'Outsider', 'outsider@example.com', NULL)
        `.execute(metaDb);
        await sql`UPDATE users SET email = 'priority@example.com' WHERE id = 'usr_0251'`.execute(
          metaDb
        );
        await sql`
          INSERT INTO collaborator (id, resource_type, resource_id, principal_id, principal_type)
          VALUES
            ('col_email_collision', 'base', ${BASE_ID}, 'aaa_email_collision', 'user'),
            ('col_name_collision', 'base', ${BASE_ID}, 'aaa_name_collision', 'user'),
            ('col_priority_name', 'base', ${BASE_ID}, 'aaa_priority_name', 'user')
        `.execute(metaDb);

        const observedData = observeDb(dataDb);
        const observedMeta = observeDb(metaDb);
        await sql`CREATE TABLE records (__id text PRIMARY KEY, user_text text)`.execute(dataDb);
        await sql`
          INSERT INTO records (__id, user_text)
          VALUES
            ('rec_email_priority', 'priority@example.com'),
            ('rec_fake_outsider', '{"id":"usr_outsider","title":"Outsider","email":"outsider@example.com"}'),
            ('rec_id_priority', 'usr_0250'),
            ('rec_name_stable', 'Shared Name')
        `.execute(dataDb);

        await executeConversion(
          observedData.db,
          observedMeta.db,
          createTextField('srcText', 'Source Text', DB_FIELD_NAME)._unsafeUnwrap(),
          createUsrField('tgtUsr', 'Target User', DB_FIELD_NAME, false)._unsafeUnwrap()
        );

        const singleRows = await sql<{ __id: string; user_text: unknown | null }>`
          SELECT __id, user_text FROM records ORDER BY __id
        `.execute(dataDb);
        expect(singleRows.rows).toEqual([
          {
            __id: 'rec_email_priority',
            user_text: {
              id: 'usr_0251',
              title: 'Shared Name',
              email: 'priority@example.com',
            },
          },
          { __id: 'rec_fake_outsider', user_text: null },
          {
            __id: 'rec_id_priority',
            user_text: {
              id: 'usr_0250',
              title: 'Shared Name',
              email: 'user-250@example.com',
            },
          },
          {
            __id: 'rec_name_stable',
            user_text: {
              id: 'usr_0001',
              title: 'Shared Name',
              email: 'user-1@example.com',
            },
          },
        ]);

        await sql`DROP TABLE records`.execute(dataDb);
        await sql`CREATE TABLE records (__id text PRIMARY KEY, user_text text)`.execute(dataDb);
        await sql`
          INSERT INTO records (__id, user_text)
          VALUES ('rec_multi', 'Shared Name, Shared Name, missing, user-300@example.com')
        `.execute(dataDb);

        await executeConversion(
          observedData.db,
          observedMeta.db,
          createTextField('srcTextMulti', 'Source Text', DB_FIELD_NAME)._unsafeUnwrap(),
          createUsrField('tgtUsrMulti', 'Target User', DB_FIELD_NAME, true)._unsafeUnwrap()
        );

        const multipleRows = await sql<{ user_text: unknown }>`
          SELECT user_text FROM records WHERE __id = 'rec_multi'
        `.execute(dataDb);
        expect(multipleRows.rows).toEqual([
          {
            user_text: [
              {
                id: 'usr_0001',
                title: 'Shared Name',
                email: 'user-1@example.com',
              },
              {
                id: 'usr_0001',
                title: 'Shared Name',
                email: 'user-1@example.com',
              },
              {
                id: 'usr_0300',
                title: 'Shared Name',
                email: 'user-300@example.com',
              },
            ],
          },
        ]);

        expect(observedMeta.metrics.profilePageQueryCount).toBeGreaterThan(2);
        // Paging bounds row count only; an individual profile's strings retain their natural size.
        expect(observedMeta.metrics.maxResultRows).toBeLessThanOrEqual(128);
        expect(observedData.metrics.maxResultRows).toBeLessThanOrEqual(1);
        expect(observedData.metrics.maxResultStringLength).toBeLessThan(1024);
        expect(observedData.metrics.maxParameterStringLength).toBeLessThan(1024);
        await expectNoTemporaryTables(dataDb);
      } finally {
        await dataDb.destroy();
        await metaDb.destroy();
      }
    });
    it('isolates temporary profile mappings between overlapping conversions', async () => {
      const { db: dataDb } = await createPGliteDb();
      const { db: metaDb } = await createPGliteDb();
      const tableA = 'tblTempScopeA000001';
      const tableB = 'tblTempScopeB000001';
      const baseA = 'bseTempScopeA000001';
      const baseB = 'bseTempScopeB000001';
      try {
        await createUserLookupMetadata(metaDb);
        await sql`
          INSERT INTO base (id, space_id)
          VALUES (${baseA}, 'spcTempScopeA00001'), (${baseB}, 'spcTempScopeB00001')
        `.execute(metaDb);
        await sql`
          INSERT INTO table_meta (id, base_id)
          VALUES (${tableA}, ${baseA}), (${tableB}, ${baseB})
        `.execute(metaDb);
        await sql`
          INSERT INTO users (id, name, email, deleted_time)
          VALUES
            ('usr_scope_a', 'Scoped User', 'scope-a@example.com', NULL),
            ('usr_scope_b', 'Scoped User', 'scope-b@example.com', NULL)
        `.execute(metaDb);
        await sql`
          INSERT INTO collaborator (id, resource_type, resource_id, principal_id, principal_type)
          VALUES
            ('col_scope_a', 'base', ${baseA}, 'usr_scope_a', 'user'),
            ('col_scope_b', 'base', ${baseB}, 'usr_scope_b', 'user')
        `.execute(metaDb);
        await sql`CREATE TABLE records_a (__id text PRIMARY KEY, user_text text)`.execute(dataDb);
        await sql`CREATE TABLE records_b (__id text PRIMARY KEY, user_text text)`.execute(dataDb);
        await sql`INSERT INTO records_a (__id, user_text) VALUES ('rec_a', 'Scoped User')`.execute(
          dataDb
        );
        await sql`INSERT INTO records_b (__id, user_text) VALUES ('rec_b', 'Scoped User')`.execute(
          dataDb
        );

        const { promise: firstPageReached, resolve: signalFirstPage } =
          Promise.withResolvers<void>();
        await metaDb.transaction().execute(async (metaTransaction) => {
          const observedMetaA = observeDb(metaTransaction, {
            afterFirstProfilePage: async () => {
              signalFirstPage();
            },
          });

          await dataDb.transaction().execute(async (transaction) => {
            const sourceA = createTextField('srcScopeA', 'Source A', DB_FIELD_NAME)._unsafeUnwrap();
            const targetA = createUsrField(
              'tgtScopeA',
              'Target A',
              DB_FIELD_NAME,
              false
            )._unsafeUnwrap();
            const sourceB = createTextField('srcScopeB', 'Source B', DB_FIELD_NAME)._unsafeUnwrap();
            const targetB = createUsrField(
              'tgtScopeB',
              'Target B',
              DB_FIELD_NAME,
              false
            )._unsafeUnwrap();
            const statementsA = buildConversionStatements(transaction, sourceA, targetA, {
              tableName: 'records_a',
              tableId: tableA,
            });
            const statementsB = buildConversionStatements(transaction, sourceB, targetB, {
              tableName: 'records_b',
              tableId: tableB,
            });
            const executionA = executeTableSchemaStatements(transaction, statementsA, {
              dataDb: transaction,
              metaDb: observedMetaA.db,
              enforceRelationAccess: true,
            });

            // A pinned PGlite transaction serializes its query hooks. Starting
            // the second conversion must not wait inside the first query hook.
            await firstPageReached;
            const executionB = executeTableSchemaStatements(transaction, statementsB, {
              dataDb: transaction,
              metaDb: metaTransaction,
              enforceRelationAccess: true,
            });
            await Promise.all([executionA, executionB]);
          });
        });

        const rowsA = await sql<{ user_text: unknown }>`SELECT user_text FROM records_a`.execute(
          dataDb
        );
        const rowsB = await sql<{ user_text: unknown }>`SELECT user_text FROM records_b`.execute(
          dataDb
        );
        expect(rowsA.rows).toEqual([
          {
            user_text: {
              id: 'usr_scope_a',
              title: 'Scoped User',
              email: 'scope-a@example.com',
            },
          },
        ]);
        expect(rowsB.rows).toEqual([
          {
            user_text: {
              id: 'usr_scope_b',
              title: 'Scoped User',
              email: 'scope-b@example.com',
            },
          },
        ]);
        await expectNoTemporaryTables(dataDb);
      } finally {
        await dataDb.destroy();
        await metaDb.destroy();
      }
    });

    it('keeps SQL-created distinct source values and a huge cell out of Node results', async () => {
      const { db: dataDb } = await createPGliteDb();
      const { db: metaDb } = await createPGliteDb();
      try {
        await insertPagedEligibleUsers(metaDb, { sameName: false });
        await sql`CREATE TABLE records (__id text PRIMARY KEY, user_text text)`.execute(dataDb);
        await sql`
          INSERT INTO records (__id, user_text)
          SELECT 'rec_' || lpad(value::text, 5, '0'), 'unmatched-' || value::text
          FROM generate_series(1, 5000) AS series(value)
        `.execute(dataDb);
        await sql`
          INSERT INTO records (__id, user_text)
          VALUES (
            'rec_huge',
            repeat('x', 1024 * 1024) || ', missing, Profile 299, Profile 300'
          )
        `.execute(dataDb);

        const observedData = observeDb(dataDb);
        const observedMeta = observeDb(metaDb);
        await executeConversion(
          observedData.db,
          observedMeta.db,
          createTextField('srcHuge', 'Source Text', DB_FIELD_NAME)._unsafeUnwrap(),
          createUsrField('tgtHuge', 'Target User', DB_FIELD_NAME, true)._unsafeUnwrap()
        );

        const unmatched = await sql<{ count: string }>`
          SELECT count(*)::text AS count FROM records WHERE user_text IS NULL
        `.execute(dataDb);
        expect(unmatched.rows).toEqual([{ count: '5000' }]);
        const huge = await sql<{ user_text: unknown }>`
          SELECT user_text FROM records WHERE __id = 'rec_huge'
        `.execute(dataDb);
        expect(huge.rows).toEqual([
          {
            user_text: [
              {
                id: 'usr_0299',
                title: 'Profile 299',
                email: 'user-299@example.com',
              },
              {
                id: 'usr_0300',
                title: 'Profile 300',
                email: 'user-300@example.com',
              },
            ],
          },
        ]);

        expect(observedMeta.metrics.profilePageQueryCount).toBeGreaterThan(2);
        expect(observedMeta.metrics.maxResultRows).toBeLessThanOrEqual(128);
        expect(observedMeta.metrics.maxParameterStringLength).toBeLessThan(1024);
        expect(observedData.metrics.maxResultRows).toBeLessThanOrEqual(1);
        expect(observedData.metrics.maxResultStringLength).toBeLessThan(1024);
        expect(observedData.metrics.maxParameterStringLength).toBeLessThan(1024);
        await expectNoTemporaryTables(dataDb);
      } finally {
        await dataDb.destroy();
        await metaDb.destroy();
      }
    });

    it('nulls populated source values when there are no eligible profiles', async () => {
      const { db: dataDb } = await createPGliteDb();
      const { db: metaDb } = await createPGliteDb();
      try {
        await createUserLookupMetadata(metaDb);
        await sql`
          INSERT INTO users (id, name, email, deleted_time)
          VALUES ('usr_outsider', 'Outsider', 'outsider@example.com', NULL)
        `.execute(metaDb);
        await sql`CREATE TABLE records (__id text PRIMARY KEY, user_text text)`.execute(dataDb);
        await sql`
          INSERT INTO records (__id, user_text)
          VALUES
            ('rec_name', 'Outsider'),
            ('rec_fake_json', '{"id":"usr_outsider","title":"Outsider"}'),
            ('rec_empty', ''),
            ('rec_null', NULL)
        `.execute(dataDb);

        const observedData = observeDb(dataDb);
        const observedMeta = observeDb(metaDb);
        await executeConversion(
          observedData.db,
          observedMeta.db,
          createTextField('srcEmpty', 'Source Text', DB_FIELD_NAME)._unsafeUnwrap(),
          createUsrField('tgtEmpty', 'Target User', DB_FIELD_NAME, false)._unsafeUnwrap()
        );

        const rows = await sql<{ __id: string; user_text: unknown | null }>`
          SELECT __id, user_text FROM records ORDER BY __id
        `.execute(dataDb);
        expect(rows.rows).toEqual([
          { __id: 'rec_empty', user_text: null },
          { __id: 'rec_fake_json', user_text: null },
          { __id: 'rec_name', user_text: null },
          { __id: 'rec_null', user_text: null },
        ]);
        expect(observedMeta.metrics.maxResultRows).toBeLessThanOrEqual(128);
        expect(observedData.metrics.maxResultRows).toBeLessThanOrEqual(1);
        await expectNoTemporaryTables(dataDb);
      } finally {
        await dataDb.destroy();
        await metaDb.destroy();
      }
    });

    it('rolls back source values and type when a later metadata page fails', async () => {
      const { db: dataDb } = await createPGliteDb();
      const { db: metaDb } = await createPGliteDb();
      try {
        await insertPagedEligibleUsers(metaDb, { sameName: true });
        await sql`CREATE TABLE records (__id text PRIMARY KEY, user_text text)`.execute(dataDb);
        await sql`
          INSERT INTO records (__id, user_text)
          VALUES ('rec_name', 'Shared Name'), ('rec_unmatched', 'missing')
        `.execute(dataDb);
        const observedData = observeDb(dataDb);
        const observedMeta = observeDb(metaDb, { throwOnProfilePage: 3 });

        await expect(
          executeConversion(
            observedData.db,
            observedMeta.db,
            createTextField('srcMetaFailure', 'Source Text', DB_FIELD_NAME)._unsafeUnwrap(),
            createUsrField('tgtMetaFailure', 'Target User', DB_FIELD_NAME, false)._unsafeUnwrap()
          )
        ).rejects.toThrow();

        expect(observedMeta.metrics.profilePageQueryCount).toBe(3);
        const rows = await sql<{ __id: string; user_text: string }>`
          SELECT __id, user_text FROM records ORDER BY __id
        `.execute(dataDb);
        expect(rows.rows).toEqual([
          { __id: 'rec_name', user_text: 'Shared Name' },
          { __id: 'rec_unmatched', user_text: 'missing' },
        ]);
        await expectTextColumn(dataDb);
        await expectNoTemporaryTables(dataDb);
      } finally {
        await dataDb.destroy();
        await metaDb.destroy();
      }
    });

    it('rolls back transformed values and type when the final ALTER fails', async () => {
      const { db: dataDb } = await createPGliteDb();
      const { db: metaDb } = await createPGliteDb();
      try {
        await insertPagedEligibleUsers(metaDb, { sameName: true });
        await sql`CREATE TABLE records (__id text PRIMARY KEY, user_text text)`.execute(dataDb);
        await sql`
          INSERT INTO records (__id, user_text)
          VALUES
            ('rec_name', 'Shared Name'),
            ('rec_fake_json', '{"id":"usr_outsider","title":"Outsider"}')
        `.execute(dataDb);
        const observedData = observeDb(dataDb, { throwOnAlterToJsonb: true });
        const observedMeta = observeDb(metaDb);

        await expect(
          executeConversion(
            observedData.db,
            observedMeta.db,
            createTextField('srcAlterFailure', 'Source Text', DB_FIELD_NAME)._unsafeUnwrap(),
            createUsrField('tgtAlterFailure', 'Target User', DB_FIELD_NAME, false)._unsafeUnwrap()
          )
        ).rejects.toThrow('injected final ALTER failure');

        expect(observedData.metrics.alterToJsonbQueryCount).toBe(1);
        const rows = await sql<{ __id: string; user_text: string }>`
          SELECT __id, user_text FROM records ORDER BY __id
        `.execute(dataDb);
        expect(rows.rows).toEqual([
          {
            __id: 'rec_fake_json',
            user_text: '{"id":"usr_outsider","title":"Outsider"}',
          },
          { __id: 'rec_name', user_text: 'Shared Name' },
        ]);
        await expectTextColumn(dataDb);
        await expectNoTemporaryTables(dataDb);
      } finally {
        await dataDb.destroy();
        await metaDb.destroy();
      }
    });

    it('resolves only table collaborators while preserving identifier priority and stable names', async () => {
      const { db: dataDb } = await createPGliteDb();
      const { db: metaDb } = await createPGliteDb();
      try {
        await sql`CREATE TABLE records (__id text PRIMARY KEY, user_text text)`.execute(dataDb);
        await sql`
          INSERT INTO records (__id, user_text)
          VALUES
            ('rec_email', 'alice@example.com'),
            ('rec_duplicate_name', 'Alice'),
            ('rec_id_priority', 'usr_alice'),
            ('rec_name', 'Bob'),
            ('rec_missing', 'random text value'),
            ('rec_outsider', 'Outsider')
        `.execute(dataDb);
        await createUserLookupMetadata(metaDb);
        await sql`
          INSERT INTO users (id, name, email, deleted_time)
          VALUES
            ('usr_alice', 'Alice', 'alice@example.com', NULL),
            ('usr_alice_z', 'Alice', 'alice-z@example.com', NULL),
            ('usr_bob', 'Bob', NULL, NULL),
            ('usr_email_collision', 'Email Collision', 'usr_alice', NULL),
            ('usr_name_collision', 'usr_alice', 'name-collision@example.com', NULL),
            ('usr_outsider', 'Outsider', 'outsider@example.com', NULL)
        `.execute(metaDb);
        await sql`
          INSERT INTO collaborator (id, resource_type, resource_id, principal_id, principal_type)
          VALUES
            ('col_alice', 'base', ${BASE_ID}, 'usr_alice', 'user'),
            ('col_alice_z', 'base', ${BASE_ID}, 'usr_alice_z', 'user'),
            ('col_bob', 'space', ${SPACE_ID}, 'usr_bob', 'user'),
            ('col_email_collision', 'base', ${BASE_ID}, 'usr_email_collision', 'user'),
            ('col_name_collision', 'base', ${BASE_ID}, 'usr_name_collision', 'user')
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
        const alice = {
          id: 'usr_alice',
          title: 'Alice',
          email: 'alice@example.com',
        };

        expect(rows.rows).toEqual([
          { __id: 'rec_duplicate_name', user_text: alice },
          { __id: 'rec_email', user_text: alice },
          { __id: 'rec_id_priority', user_text: alice },
          { __id: 'rec_missing', user_text: null },
          {
            __id: 'rec_name',
            user_text: {
              id: 'usr_bob',
              title: 'Bob',
              email: null,
            },
          },
          { __id: 'rec_outsider', user_text: null },
        ]);
      } finally {
        await dataDb.destroy();
        await metaDb.destroy();
      }
    });

    it('creates multiple-user arrays from collaborators and omits non-collaborators', async () => {
      const { db: dataDb } = await createPGliteDb();
      const { db: metaDb } = await createPGliteDb();
      try {
        await sql`CREATE TABLE records (__id text PRIMARY KEY, user_text text)`.execute(dataDb);
        await sql`
          INSERT INTO records (__id, user_text)
          VALUES ('rec_multi', 'Alice, Outsider, Bob')
        `.execute(dataDb);
        await createUserLookupMetadata(metaDb);
        await sql`
          INSERT INTO users (id, name, email, deleted_time)
          VALUES
            ('usr_alice', 'Alice', 'alice@example.com', NULL),
            ('usr_bob', 'Bob', NULL, NULL),
            ('usr_outsider', 'Outsider', 'outsider@example.com', NULL)
        `.execute(metaDb);
        await sql`
          INSERT INTO collaborator (id, resource_type, resource_id, principal_id, principal_type)
          VALUES
            ('col_alice', 'base', ${BASE_ID}, 'usr_alice', 'user'),
            ('col_bob', 'space', ${SPACE_ID}, 'usr_bob', 'user')
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
          },
          {
            id: 'usr_bob',
            title: 'Bob',
            email: null,
          },
        ]);
      } finally {
        await dataDb.destroy();
        await metaDb.destroy();
      }
    });

    it('propagates metadata lookup failures without clearing source values', async () => {
      const { db: dataDb } = await createPGliteDb();
      const { db: metaDb } = await createPGliteDb();
      try {
        await sql`CREATE TABLE records (__id text PRIMARY KEY, user_text text)`.execute(dataDb);
        await sql`INSERT INTO records (__id, user_text) VALUES ('rec_alice', 'Alice')`.execute(
          dataDb
        );

        await expect(
          executeConversion(
            dataDb,
            metaDb,
            createTextField('srcText', 'Source Text', DB_FIELD_NAME)._unsafeUnwrap(),
            createUsrField('tgtUsr', 'Target User', DB_FIELD_NAME, false)._unsafeUnwrap()
          )
        ).rejects.toMatchObject({ message: 'Failed to lookup users' });

        const rows = await sql<{ user_text: string }>`SELECT user_text FROM records`.execute(
          dataDb
        );
        expect(rows.rows).toEqual([{ user_text: 'Alice' }]);
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
    it('quotes choice names that contain a comma, quote, or newline when converting to text', async () => {
      const { db: dataDb } = await createPGliteDb();
      const { db: metaDb } = await createPGliteDb();
      try {
        await sql`CREATE TABLE records (__id text PRIMARY KEY, user_text jsonb)`.execute(dataDb);
        await sql`
          INSERT INTO records (__id, user_text)
          VALUES
            ('r1', ${JSON.stringify(['A', 'B, C'])}::jsonb),
            ('r2', ${JSON.stringify(['A'])}::jsonb),
            ('r3', ${JSON.stringify(['say "hi"', 'line\nbreak'])}::jsonb)
        `.execute(dataDb);

        await executeConversion(
          dataDb,
          metaDb,
          createMultiSelField('srcMulti', 'Tags', DB_FIELD_NAME)._unsafeUnwrap(),
          createTextField('tgtText', 'Tags Text', DB_FIELD_NAME)._unsafeUnwrap()
        );

        const rows = await sql<{ __id: string; user_text: string | null }>`
          SELECT __id, user_text
          FROM records
          ORDER BY __id
        `.execute(dataDb);

        expect(rows.rows).toEqual([
          { __id: 'r1', user_text: 'A, "B, C"' },
          { __id: 'r2', user_text: 'A' },
          { __id: 'r3', user_text: '"say ""hi""", "line\nbreak"' },
        ]);
      } finally {
        await dataDb.destroy();
        await metaDb.destroy();
      }
    });

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
