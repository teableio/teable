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
const PRIVATE_USE_USER_ID = `usr${String.fromCodePoint(0xe000)}`;
const EMOJI_USER_ID = `usr${String.fromCodePoint(0x1f600)}`;

let beforeExecuteQuery: ((compiledQuery: CompiledQuery) => void | Promise<void>) | undefined;

class PGliteConnection {
  constructor(private readonly client: PGlite) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    await beforeExecuteQuery?.(compiledQuery);
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
        id text COLLATE "C" PRIMARY KEY,
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
        ('usrAaron', 'Aaron', 'aaron@example.com', NULL, NULL),
        ('usrAlice', 'Alice', 'alice@example.com', '13800000000', NULL),
        ('usrBob', 'Bob', 'bob@example.com', NULL, NULL),
        ('usrCarol', 'Carol', 'carol@example.com', NULL, NULL),
        ('usrGone', 'Gone', 'gone@example.com', NULL, now()),
        ('usrOutsider', 'Outsider', 'outsider@example.com', NULL, NULL),
        ('usrDeptDan', 'Dan', 'dan@example.com', NULL, NULL),
        ('usrNestedNed', 'Ned', 'ned@example.com', NULL, NULL),
        ('usrTwinA', 'Twin', 'twin-a@example.com', NULL, NULL),
        ('usrTwinB', 'Twin', 'twin-b@example.com', NULL, NULL),
        (${PRIVATE_USE_USER_ID}, 'CollationTwin', 'collation-private@example.com', NULL, NULL),
        (${EMOJI_USER_ID}, 'CollationTwin', 'collation-emoji@example.com', NULL, NULL)
    `.execute(db);
    await sql`
      INSERT INTO collaborator (id, resource_type, resource_id, principal_id, principal_type) VALUES
        ('colAaron', 'base', ${BASE_ID}, 'usrAaron', 'user'),
        ('colAlice', 'base', ${BASE_ID}, 'usrAlice', 'user'),
        ('colBob', 'space', ${SPACE_ID}, 'usrBob', 'user'),
        ('colCarol', 'base', 'bseOtherBase0000000', 'usrCarol', 'user'),
        ('colGone', 'base', ${BASE_ID}, 'usrGone', 'user'),
        ('colTwinA', 'base', ${BASE_ID}, 'usrTwinA', 'user'),
        ('colTwinB', 'space', ${SPACE_ID}, 'usrTwinB', 'user'),
        ('colCollationPrivate', 'base', ${BASE_ID}, ${PRIVATE_USE_USER_ID}, 'user'),
        ('colCollationEmoji', 'base', ${BASE_ID}, ${EMOJI_USER_ID}, 'user')
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

    it('returns users ordered by id regardless of identifier order', async () => {
      const service = new PostgresUserLookupService(db);
      const result = await service.listTableUsersByIdentifiers(TABLE_ID, [
        'Bob',
        'bob@example.com',
        'usrAlice',
      ]);

      expect(result._unsafeUnwrap()).toEqual([
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

    it('returns every scoped user sharing the same name', async () => {
      const service = new PostgresUserLookupService(db);
      const result = await service.listTableUsersByIdentifiers(TABLE_ID, ['Twin']);

      expect(result._unsafeUnwrap().map((row) => row.id)).toEqual(['usrTwinA', 'usrTwinB']);
    });

    it('preserves PostgreSQL collation order for same-name users', async () => {
      const { rows: expectedRows } = await sql<{ id: string }>`
        select id
        from users
        where name = 'CollationTwin'
        order by id
      `.execute(db);
      const expectedIds = expectedRows.map((row) => row.id);
      const javascriptOrderedIds = [...expectedIds].sort((left, right) =>
        left < right ? -1 : left > right ? 1 : 0
      );
      expect(expectedIds).toHaveLength(2);
      expect(javascriptOrderedIds).not.toEqual(expectedIds);

      const service = new PostgresUserLookupService(db);
      const result = await service.listTableUsersByIdentifiers(TABLE_ID, ['CollationTwin']);

      expect(result._unsafeUnwrap().map((row) => row.id)).toEqual(expectedIds);
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

    it('resolves more identifiers than a single PostgreSQL query can bind', async () => {
      const service = new PostgresUserLookupService(db);
      // 21,845 distinct identifiers would compile to 65,537 parameters in
      // the unbatched query: two table ids plus three copies of each value.
      const identifiers = Array.from({ length: 21_845 }, (_, index) => `missing-${index}`);
      identifiers[0] = 'Alice';
      identifiers[1] = 'Twin';
      identifiers[2] = PRIVATE_USE_USER_ID;
      identifiers[10_000] = 'usrBob';
      identifiers[10_001] = 'alice@example.com';
      identifiers[10_002] = EMOJI_USER_ID;
      identifiers[21_844] = 'usrAaron';

      const result = await service.listTableUsersByIdentifiers(TABLE_ID, identifiers);

      expect(result._unsafeUnwrap().map((row) => row.id)).toEqual([
        'usrAaron',
        'usrAlice',
        'usrBob',
        'usrTwinA',
        'usrTwinB',
        PRIVATE_USE_USER_ID,
        EMOJI_USER_ID,
      ]);
    });

    it('propagates a failure from a later identifier batch without returning partial rows', async () => {
      const service = new PostgresUserLookupService(db);
      // Prime the optional-department capability check so the interceptor below
      // observes only the bounded lookup batches.
      (await service.listTableUsersByIdentifiers(TABLE_ID, ['usrAlice']))._unsafeUnwrap();

      let batchCount = 0;
      beforeExecuteQuery = () => {
        batchCount += 1;
        if (batchCount === 2) throw new Error('second batch failed');
      };

      try {
        const identifiers = Array.from({ length: 10_001 }, (_, index) => `missing-${index}`);
        identifiers[0] = 'usrAlice';
        const result = await service.listTableUsersByIdentifiers(TABLE_ID, identifiers);

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toMatchObject({
          tags: ['infrastructure'],
          message: 'Failed to lookup users',
          details: { error: 'second batch failed' },
        });
      } finally {
        beforeExecuteQuery = undefined;
      }
    });

    it('drops a user whose collaborator grant is revoked before the final read', async () => {
      const service = new PostgresUserLookupService(db);
      // Prime the optional-department capability check so the interceptor below
      // observes only the identifier lookup and the final profile read.
      (await service.listTableUsersByIdentifiers(TABLE_ID, ['usrAlice']))._unsafeUnwrap();

      let revoked = false;
      beforeExecuteQuery = async (compiledQuery) => {
        if (revoked || !compiledQuery.sql.includes('= any(')) return;
        revoked = true;
        // The grant disappears after the identifier batch resolved usrAlice but
        // before the query that reads the profile. The lookup must not return
        // the now-unscoped account.
        beforeExecuteQuery = undefined;
        await sql`DELETE FROM collaborator WHERE id = 'colAlice'`.execute(db);
      };

      try {
        const result = await service.listTableUsersByIdentifiers(TABLE_ID, ['Alice']);

        expect(revoked).toBe(true);
        expect(result._unsafeUnwrap()).toEqual([]);
      } finally {
        beforeExecuteQuery = undefined;
        await sql`
          INSERT INTO collaborator (id, resource_type, resource_id, principal_id, principal_type)
          VALUES ('colAlice', 'base', ${BASE_ID}, 'usrAlice', 'user')
        `.execute(db);
      }
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

  describe('listUsersByIdentityPairs', () => {
    it('returns only exact active id and email pairs from the same row', async () => {
      const service = new PostgresUserLookupService(db);
      const result = await service.listUsersByIdentityPairs([
        { id: 'usrOutsider', email: 'outsider@example.com' },
        { id: 'usrAlice', email: 'bob@example.com' },
        { id: 'usrBob', email: 'BOB@example.com' },
        { id: 'usrGone', email: 'gone@example.com' },
        { id: 'usrMissing', email: 'outsider@example.com' },
      ]);
      expect(result._unsafeUnwrap()).toMatchObject([
        { id: 'usrOutsider', email: 'outsider@example.com' },
      ]);
    });

    it('batches large pair lists and fails closed on a later query', async () => {
      const service = new PostgresUserLookupService(db);
      const pairs = Array.from({ length: 10_001 }, (_, index) => ({
        id: `missing-${index}`,
        email: `missing-${index}@example.invalid`,
      }));
      pairs[0] = { id: 'usrOutsider', email: 'outsider@example.com' };
      let calls = 0;
      beforeExecuteQuery = () => {
        calls += 1;
        if (calls === 2) throw new Error('later identity batch failed');
      };
      try {
        const result = await service.listUsersByIdentityPairs(pairs);
        expect(result._unsafeUnwrapErr()).toMatchObject({
          message: 'Failed to lookup users',
          tags: ['infrastructure'],
        });
        expect(calls).toBe(2);
      } finally {
        beforeExecuteQuery = undefined;
      }
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
