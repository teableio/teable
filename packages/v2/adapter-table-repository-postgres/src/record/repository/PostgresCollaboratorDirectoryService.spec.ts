import { PGlite } from '@electric-sql/pglite';
import { ActorId, BaseId, OffsetPagination, PageLimit, PageOffset } from '@teable/v2-core';
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresCollaboratorDirectoryService } from './PostgresCollaboratorDirectoryService';

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

describe('PostgresCollaboratorDirectoryService (pglite)', () => {
  let db: Kysely<V1TeableDatabase>;
  const context = { actorId: ActorId.create('tester')._unsafeUnwrap() };
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const defaultPage = OffsetPagination.create(
    PageLimit.create(50)._unsafeUnwrap(),
    PageOffset.zero()
  );

  beforeAll(async () => {
    db = new Kysely<V1TeableDatabase>({ dialect: createPGliteDialect(new PGlite()) });

    await sql`
      CREATE TABLE users (
        id text PRIMARY KEY,
        name text NOT NULL,
        email text,
        avatar text,
        is_system boolean
      )
    `.execute(db);
    await sql`
      CREATE TABLE "base" (
        id text PRIMARY KEY,
        space_id text NOT NULL
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

    await sql`INSERT INTO "base" (id, space_id) VALUES (${BASE_ID}, ${SPACE_ID})`.execute(db);
    await sql`
      INSERT INTO users (id, name, email, avatar, is_system) VALUES
        ('usrAlice', 'Alice', 'private-alice@example.com', 'alice.png', false),
        ('usrBob', 'Bob', 'private-bob@example.com', NULL, NULL),
        ('usrSystem', 'System', 'system@example.com', NULL, true),
        ('usrDan', 'Dan', 'dan@example.com', NULL, false),
        ('usrNed', 'Ned', 'ned@example.com', NULL, false)
    `.execute(db);
    await sql`
      INSERT INTO collaborator (
        id, resource_type, resource_id, principal_id, principal_type, created_time
      ) VALUES
        ('clbAlice', 'base', ${BASE_ID}, 'usrAlice', 'user', '2025-01-03'),
        ('clbBob', 'space', ${SPACE_ID}, 'usrBob', 'user', '2025-01-02'),
        ('clbSystem', 'space', ${SPACE_ID}, 'usrSystem', 'user', '2025-01-01')
    `.execute(db);
  });

  afterAll(async () => {
    await db.destroy().catch(() => {});
  });

  it('lists Base/Space collaborators by name only and excludes system users', async () => {
    const service = new PostgresCollaboratorDirectoryService(db);
    const firstPage = OffsetPagination.create(
      PageLimit.create(1)._unsafeUnwrap(),
      PageOffset.zero()
    );

    expect(
      (await service.listBaseUsers(context, baseId, { pagination: firstPage }))._unsafeUnwrap()
    ).toEqual([{ id: 'usrAlice', name: 'Alice', avatar: 'alice.png' }]);
    expect(
      (
        await service.listBaseUsers(context, baseId, {
          pagination: defaultPage,
          search: 'private-alice@example.com',
        })
      )._unsafeUnwrap()
    ).toEqual([]);
    expect(
      (
        await service.listUsersByIds(context, ['usrAlice', 'usrBob', 'usrAlice'], {
          pagination: defaultPage,
          search: 'Bob',
        })
      )._unsafeUnwrap()
    ).toEqual([{ id: 'usrBob', name: 'Bob', avatar: null }]);
  });

  it('expands department collaborators including nested department members', async () => {
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
        ('usrDan', 'deptRoot'),
        ('usrNed', 'deptChild'),
        ('usrAlice', 'deptRoot')
    `.execute(db);
    await sql`
      INSERT INTO collaborator (
        id, resource_type, resource_id, principal_id, principal_type, created_time
      ) VALUES
        ('clbDept', 'space', ${SPACE_ID}, 'deptRoot', 'department', '2025-01-04')
    `.execute(db);

    const service = new PostgresCollaboratorDirectoryService(db);
    const users = (
      await service.listBaseUsers(context, baseId, { pagination: defaultPage })
    )._unsafeUnwrap();
    const ids = users.map((user) => user.id).sort();

    // Alice is already a direct user collaborator; Dan is a direct department
    // member; Ned belongs to a child department whose path contains deptRoot.
    expect(ids).toEqual(['usrAlice', 'usrBob', 'usrDan', 'usrNed']);
    expect(users.filter((user) => user.id === 'usrAlice')).toHaveLength(1);

    const byName = (
      await service.listBaseUsers(context, baseId, {
        pagination: defaultPage,
        search: 'Ned',
      })
    )._unsafeUnwrap();
    expect(byName.map((user) => user.id)).toEqual(['usrNed']);
  });
});
