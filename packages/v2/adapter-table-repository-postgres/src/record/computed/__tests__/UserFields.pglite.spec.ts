/**
 * End-to-end integration test for CreatedBy/LastModifiedBy fields.
 *
 * This test verifies the complete flow:
 * 1. INSERT record with system columns (__created_by, __last_modified_by) storing user IDs
 * 2. INSERT also populates user field columns with full user objects via subquery
 * 3. SELECT reads the pre-populated JSON value directly (no computed update needed)
 *
 * This matches v1 behavior where user fields are populated during INSERT, not computed update.
 *
 * Uses PGlite to test actual database behavior.
 */
import { PGlite } from '@electric-sql/pglite';
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
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

const TEST_SCHEMA = 'test_base';
const TEST_TABLE_NAME = 'test_table';

// Fixed IDs for stable tests
const RECORD_ID = `rec${'f'.repeat(16)}`;
const USER_ID = 'usr_test_user';
const USER_NAME = 'Test User';
const USER_EMAIL = 'test@example.com';

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

describe('UserFields PGlite E2E integration', () => {
  let pglite: PGlite;
  let db: Kysely<V1TeableDatabase>;
  const fullTableName = `${TEST_SCHEMA}.${TEST_TABLE_NAME}`;

  beforeAll(async () => {
    pglite = await PGlite.create();
    db = new Kysely<V1TeableDatabase>({
      dialect: new PGliteDialect(pglite),
    });

    // Create schema
    await db.schema.createSchema(TEST_SCHEMA).ifNotExists().execute();

    // Create public schema users table (required for user field population)
    await db.schema
      .createTable('users')
      .ifNotExists()
      .addColumn('id', 'varchar', (col) => col.primaryKey())
      .addColumn('name', 'varchar')
      .addColumn('email', 'varchar')
      .execute();

    // Insert test user
    await db
      .insertInto('users' as any)
      .values({
        id: USER_ID,
        name: USER_NAME,
        email: USER_EMAIL,
      })
      .execute();

    // Create test table with system columns and user field columns
    await db.schema
      .createTable(fullTableName)
      .addColumn('__id', 'varchar', (col) => col.primaryKey())
      .addColumn('__created_time', 'timestamp')
      .addColumn('__created_by', 'varchar') // System column stores user ID
      .addColumn('__last_modified_time', 'timestamp')
      .addColumn('__last_modified_by', 'varchar') // System column stores user ID
      .addColumn('__version', 'integer', (col) => col.defaultTo(1))
      .addColumn('col_name', 'varchar') // Text field
      .addColumn('col_created_by', 'jsonb') // CreatedBy field stores full user object
      .addColumn('col_last_modified_by', 'jsonb') // LastModifiedBy field stores full user object
      .execute();
  });

  afterAll(async () => {
    await db.destroy();
    await pglite.close();
  });

  it('should populate user fields with complete user object directly in INSERT via subquery', async () => {
    const now = new Date().toISOString();
    const avatarPrefix = '/api/attachments/read/public/avatar/';

    // INSERT record with user field columns populated via subquery (simulating RecordInsertBuilder behavior)
    // This matches what RecordInsertBuilder now generates - INSERT with subquery values for user fields
    const createdBySubquery = sql`(
      SELECT jsonb_build_object(
        'id', u.id,
        'title', u.name,
        'email', u.email,
        'avatarUrl', ${avatarPrefix} || u.id
      )
      FROM public.users u
      WHERE u.id = ${USER_ID}
    )`;

    const lastModifiedBySubquery = sql`(
      SELECT jsonb_build_object(
        'id', u.id,
        'title', u.name,
        'email', u.email,
        'avatarUrl', ${avatarPrefix} || u.id
      )
      FROM public.users u
      WHERE u.id = ${USER_ID}
    )`;

    await db
      .insertInto(fullTableName as any)
      .values({
        __id: RECORD_ID,
        __created_time: now,
        __created_by: USER_ID, // System column stores user ID
        __last_modified_time: now,
        __last_modified_by: USER_ID, // System column stores user ID
        __version: 1,
        col_name: 'Test Record',
        col_created_by: createdBySubquery, // User field populated via subquery
        col_last_modified_by: lastModifiedBySubquery, // User field populated via subquery
      } as any)
      .execute();

    // Verify user fields are populated immediately after INSERT (no UPDATE needed)
    const afterInsert = await db
      .selectFrom(fullTableName as any)
      .select(['col_created_by', 'col_last_modified_by', '__created_by', '__last_modified_by'])
      .where('__id', '=', RECORD_ID)
      .executeTakeFirst();

    expect(afterInsert).toBeDefined();

    // CreatedBy field should have complete user object
    const createdByValue = afterInsert!.col_created_by;
    expect(createdByValue).not.toBeNull();
    expect(typeof createdByValue).toBe('object');
    expect(createdByValue.id).toBe(USER_ID);
    expect(createdByValue.title).toBe(USER_NAME);
    expect(createdByValue.email).toBe(USER_EMAIL);
    expect(createdByValue.avatarUrl).toContain(USER_ID);

    // LastModifiedBy field should have complete user object
    const lastModifiedByValue = afterInsert!.col_last_modified_by;
    expect(lastModifiedByValue).not.toBeNull();
    expect(typeof lastModifiedByValue).toBe('object');
    expect(lastModifiedByValue.id).toBe(USER_ID);
    expect(lastModifiedByValue.title).toBe(USER_NAME);
    expect(lastModifiedByValue.email).toBe(USER_EMAIL);
    expect(lastModifiedByValue.avatarUrl).toContain(USER_ID);

    // System columns should still contain just the user ID
    expect(afterInsert!.__created_by).toBe(USER_ID);
    expect(afterInsert!.__last_modified_by).toBe(USER_ID);
  });

  it('should handle user that does not exist in users table (with fallback)', async () => {
    const nonExistentUserId = 'usr_does_not_exist';
    const recordId2 = `rec${'g'.repeat(16)}`;
    const now = new Date().toISOString();
    const avatarPrefix = '/api/attachments/read/public/avatar/';

    // INSERT record with non-existent user ID - COALESCE provides fallback
    const createdBySubquery = sql`COALESCE(
      (
        SELECT jsonb_build_object(
          'id', u.id,
          'title', u.name,
          'email', u.email,
          'avatarUrl', ${avatarPrefix} || u.id
        )
        FROM public.users u
        WHERE u.id = ${nonExistentUserId}::text
      ),
      jsonb_build_object(
        'id', ${nonExistentUserId}::text,
        'title', ${nonExistentUserId}::text,
        'email', NULL::text,
        'avatarUrl', ${avatarPrefix}::text || ${nonExistentUserId}::text
      )
    )`;

    const lastModifiedBySubquery = sql`COALESCE(
      (
        SELECT jsonb_build_object(
          'id', u.id,
          'title', u.name,
          'email', u.email,
          'avatarUrl', ${avatarPrefix} || u.id
        )
        FROM public.users u
        WHERE u.id = ${nonExistentUserId}::text
      ),
      jsonb_build_object(
        'id', ${nonExistentUserId}::text,
        'title', ${nonExistentUserId}::text,
        'email', NULL::text,
        'avatarUrl', ${avatarPrefix}::text || ${nonExistentUserId}::text
      )
    )`;

    await db
      .insertInto(fullTableName as any)
      .values({
        __id: recordId2,
        __created_time: now,
        __created_by: nonExistentUserId,
        __last_modified_time: now,
        __last_modified_by: nonExistentUserId,
        __version: 1,
        col_name: 'Test Record 2',
        col_created_by: createdBySubquery,
        col_last_modified_by: lastModifiedBySubquery,
      } as any)
      .execute();

    // Verify user fields have fallback values when user doesn't exist
    const afterInsert = await db
      .selectFrom(fullTableName as any)
      .select(['col_created_by', 'col_last_modified_by'])
      .where('__id', '=', recordId2)
      .executeTakeFirst();

    expect(afterInsert).toBeDefined();
    // When user doesn't exist, COALESCE provides a fallback object with the user ID
    expect(afterInsert!.col_created_by).not.toBeNull();
    expect(afterInsert!.col_created_by.id).toBe(nonExistentUserId);
    expect(afterInsert!.col_created_by.title).toBe(nonExistentUserId);
    expect(afterInsert!.col_created_by.email).toBeNull();
    expect(afterInsert!.col_last_modified_by).not.toBeNull();
    expect(afterInsert!.col_last_modified_by.id).toBe(nonExistentUserId);
  });
});
