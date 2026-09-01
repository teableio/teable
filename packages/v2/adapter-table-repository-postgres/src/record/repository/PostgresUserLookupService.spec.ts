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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PostgresUserLookupService } from './PostgresUserLookupService';

const TABLE_ID = 'tblxxxxxxxxxxxxxxxx';
const BASE_ID = 'bsexxxxxxxxxxxxxxxx';
const SPACE_ID = 'spcxxxxxxxxxxxxxxxx';

class PGliteConnection {
  constructor(private readonly client: PGlite) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const result = await this.client.query<R>(compiledQuery.sql, [...compiledQuery.parameters]);
    return {
      rows: result.rows,
      numAffectedRows: result.affectedRows ? BigInt(result.affectedRows) : undefined,
    };
  }

  async *streamQuery(): AsyncGenerator<never> {
    throw new Error('PGlite does not support streaming.');
  }
}

const createPGliteDialect = (client: PGlite): Dialect => ({
  createAdapter: () => new PostgresAdapter(),
  createDriver: () => ({
    init: async () => {},
    acquireConnection: async () => new PGliteConnection(client),
    beginTransaction: async () => {},
    commitTransaction: async () => {},
    rollbackTransaction: async () => {},
    releaseConnection: async () => {},
    destroy: async () => client.close(),
  }),
  createIntrospector: (db) => new PostgresIntrospector(db),
  createQueryCompiler: () => new PostgresQueryCompiler(),
});

describe('PostgresUserLookupService (pglite)', () => {
  let db: Kysely<V1TeableDatabase>;

  beforeAll(async () => {
    db = new Kysely<V1TeableDatabase>({ dialect: createPGliteDialect(new PGlite()) });

    await sql`
      CREATE TABLE users (
        id text PRIMARY KEY,
        name text NOT NULL,
        email text,
        phone text,
        deleted_time timestamptz
      )
    `.execute(db);
    await sql`
      CREATE TABLE base (
        id text PRIMARY KEY,
        space_id text NOT NULL
      )
    `.execute(db);
    await sql`
      CREATE TABLE table_meta (
        id text PRIMARY KEY,
        base_id text NOT NULL
      )
    `.execute(db);
    await sql`
      CREATE TABLE collaborator (
        id text PRIMARY KEY,
        resource_type text NOT NULL,
        resource_id text NOT NULL,
        principal_id text NOT NULL,
        principal_type text NOT NULL,
        created_time timestamptz NOT NULL DEFAULT now()
      )
    `.execute(db);

    await sql`INSERT INTO base (id, space_id) VALUES (${BASE_ID}, ${SPACE_ID})`.execute(db);
    await sql`INSERT INTO table_meta (id, base_id) VALUES (${TABLE_ID}, ${BASE_ID})`.execute(db);
    await sql`
      INSERT INTO users (id, name, email, phone, deleted_time) VALUES
        ('usrAlice', 'Alice', 'alice@example.com', '13800000000', NULL),
        ('usrBob', 'Bob', 'bob@example.com', NULL, NULL),
        ('usrCarol', 'Carol', 'carol@example.com', NULL, NULL),
        ('usrGone', 'Gone', 'gone@example.com', NULL, now()),
        ('usrOutsider', 'Outsider', 'outsider@example.com', NULL, NULL),
        ('usrDeptDan', 'Dan', 'dan@example.com', NULL, NULL),
        ('usrNestedNed', 'Ned', 'ned@example.com', NULL, NULL)
    `.execute(db);
    await sql`
      INSERT INTO collaborator (id, resource_type, resource_id, principal_id, principal_type) VALUES
        ('colAlice', 'base', ${BASE_ID}, 'usrAlice', 'user'),
        ('colBob', 'space', ${SPACE_ID}, 'usrBob', 'user'),
        ('colCarol', 'base', 'bseOtherBase0000000', 'usrCarol', 'user'),
        ('colGone', 'base', ${BASE_ID}, 'usrGone', 'user')
    `.execute(db);
  });

  afterAll(async () => {
    await db.destroy().catch(() => {});
  });

  describe('listTableUsersByIdentifiers', () => {
    it('returns early when there are no identifiers to lookup', async () => {
      const service = new PostgresUserLookupService(db);
      const result = await service.listTableUsersByIdentifiers(TABLE_ID, ['', '', '']);
      expect(result._unsafeUnwrap()).toEqual([]);
    });

    it('resolves base and space collaborators by id / email / name', async () => {
      const service = new PostgresUserLookupService(db);
      const result = await service.listTableUsersByIdentifiers(TABLE_ID, [
        'usrAlice',
        'bob@example.com',
        'Bob',
      ]);

      const rows = [...result._unsafeUnwrap()].sort((a, b) => a.id.localeCompare(b.id));
      expect(rows).toEqual([
        {
          id: 'usrAlice',
          name: 'Alice',
          email: 'alice@example.com',
          avatarUrl: '/api/attachments/read/public/avatar/usrAlice',
        },
        {
          id: 'usrBob',
          name: 'Bob',
          email: 'bob@example.com',
          avatarUrl: '/api/attachments/read/public/avatar/usrBob',
        },
      ]);
    });

    it('does not resolve collaborators by phone number (v1 matchUser parity)', async () => {
      const service = new PostgresUserLookupService(db);
      const result = await service.listTableUsersByIdentifiers(TABLE_ID, ['13800000000']);
      expect(result._unsafeUnwrap()).toEqual([]);
    });

    it('excludes non-collaborators, other-base collaborators, and deleted users', async () => {
      const service = new PostgresUserLookupService(db);
      const result = await service.listTableUsersByIdentifiers(TABLE_ID, [
        'usrOutsider',
        'usrCarol',
        'usrGone',
      ]);
      expect(result._unsafeUnwrap()).toEqual([]);
    });

    it('expands department collaborators (including nested departments) when org tables exist', async () => {
      await sql`
        CREATE TABLE organization_department (
          id text PRIMARY KEY,
          name text NOT NULL,
          path jsonb
        )
      `.execute(db);
      await sql`
        CREATE TABLE organization_user_department (
          user_id text NOT NULL,
          department_id text NOT NULL
        )
      `.execute(db);
      await sql`
        INSERT INTO organization_department (id, name, path) VALUES
          ('deptRoot', 'Root', NULL),
          ('deptChild', 'Child', '["deptRoot"]'::jsonb)
      `.execute(db);
      await sql`
        INSERT INTO organization_user_department (user_id, department_id) VALUES
          ('usrDeptDan', 'deptRoot'),
          ('usrNestedNed', 'deptChild')
      `.execute(db);
      await sql`
        INSERT INTO collaborator (id, resource_type, resource_id, principal_id, principal_type)
        VALUES ('colDeptRoot', 'base', ${BASE_ID}, 'deptRoot', 'department')
      `.execute(db);

      const service = new PostgresUserLookupService(db);
      const result = await service.listTableUsersByIdentifiers(TABLE_ID, ['Dan', 'Ned']);

      const ids = [...result._unsafeUnwrap()].map((row) => row.id).sort();
      // deptRoot is a base collaborator; Dan is a direct member and Ned is a
      // member of a child department whose path contains deptRoot.
      expect(ids).toEqual(['usrDeptDan', 'usrNestedNed']);
    });
  });

  describe('listUsersByIds', () => {
    it('returns early when there are no ids', async () => {
      const service = new PostgresUserLookupService(db);
      const result = await service.listUsersByIds(['']);
      expect(result._unsafeUnwrap()).toEqual([]);
    });

    it('looks up by primary key only, without collaborator scoping', async () => {
      const service = new PostgresUserLookupService(db);
      const result = await service.listUsersByIds(['usrOutsider', 'usrOutsider']);
      expect(result._unsafeUnwrap()).toEqual([
        {
          id: 'usrOutsider',
          name: 'Outsider',
          email: 'outsider@example.com',
          avatarUrl: '/api/attachments/read/public/avatar/usrOutsider',
        },
      ]);
    });

    it('excludes deleted users by default', async () => {
      const service = new PostgresUserLookupService(db);
      const result = await service.listUsersByIds(['usrGone', 'usrAlice']);
      expect(result._unsafeUnwrap().map((row) => row.id)).toEqual(['usrAlice']);
    });

    it('includes deleted users when includeDeleted is set (display enrichment)', async () => {
      const service = new PostgresUserLookupService(db);
      const result = await service.listUsersByIds(['usrGone'], { includeDeleted: true });
      expect(result._unsafeUnwrap().map((row) => row.id)).toEqual(['usrGone']);
    });

    it('uses the public storage prefix for s3 avatar URLs', async () => {
      vi.stubEnv('BACKEND_STORAGE_PROVIDER', 's3');
      vi.stubEnv('STORAGE_PREFIX', 'https://s3.us-west-2.amazonaws.com/storage-public.teable.io');

      const service = new PostgresUserLookupService(db);
      const result = await service.listUsersByIds(['usrAlice']);
      expect(result._unsafeUnwrap()[0]?.avatarUrl).toBe(
        'https://s3.us-west-2.amazonaws.com/storage-public.teable.io/avatar/usrAlice'
      );

      vi.unstubAllEnvs();
    });

    it('wraps lookup failures as infrastructure errors', async () => {
      const service = new PostgresUserLookupService(db);
      await db.destroy().catch(() => {});
      const result = await service.listUsersByIds(['usrAlice']);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        tags: ['infrastructure'],
        message: 'Failed to lookup users',
      });
    });
  });
});
