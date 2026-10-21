/* eslint-disable @typescript-eslint/naming-convention */
import { randomUUID } from 'node:crypto';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { getPermissions, TemplatePermissions } from '@teable/core';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admitDataQueryResource, type IDataQueryAdmissionDb } from './v2-data-query-admission';

const describePg = process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1' ? describe : describe.skip;

describePg('query-owned metadata admission (PostgreSQL)', () => {
  const schema = `QueryAdmission_${randomUUID().replaceAll('-', '')}`;
  let db: Kysely<IDataQueryAdmissionDb>;
  let metaDb: Kysely<IDataQueryAdmissionDb>;
  const statements: string[] = [];
  const user = { actorId: 'usr-member', departmentIds: [] };
  const app = { actorId: 'appRobot', departmentIds: [], tempAuthBaseId: 'bse-one' };

  beforeAll(async () => {
    if (!process.env.PRISMA_DATABASE_URL)
      throw new Error('Isolated PRISMA_DATABASE_URL is required');
    db = new Kysely<IDataQueryAdmissionDb>({
      dialect: new PostgresDialect({
        pool: new Pool({ connectionString: process.env.PRISMA_DATABASE_URL, max: 2 }),
      }),
      log: (event) => {
        if (event.level === 'query') statements.push(event.query.sql);
      },
    });
    await db.schema.createSchema(schema).execute();
    metaDb = db.withSchema(schema);
    await sql`create table ${sql.id(schema, 'space')} (id text primary key, deleted_time timestamptz)`.execute(
      db
    );
    await sql`create table ${sql.id(schema, 'base')} (id text primary key, space_id text, deleted_time timestamptz)`.execute(
      db
    );
    await sql`create table ${sql.id(schema, 'template')} (id text primary key, snapshot text)`.execute(
      db
    );
    await sql`create table ${sql.id(schema, 'collaborator')} (id text primary key, resource_type text, resource_id text, principal_id text, principal_type text, role_name text)`.execute(
      db
    );
    await sql`create table ${sql.id(schema, 'access_token')} (id text primary key, user_id text, client_id text, scopes text, space_ids text, base_ids text, has_full_access boolean)`.execute(
      db
    );
    await sql`create table ${sql.id(schema, 'space_data_db_binding')} (id text primary key, space_id text unique, data_db_connection_id text, mode text, state text)`.execute(
      db
    );
    await sql`create table ${sql.id(schema, 'data_db_connection')} (id text primary key, status text, encrypted_url text, internal_schema text, url_fingerprint text, display_host text, display_database text)`.execute(
      db
    );
    await sql`insert into ${sql.id(schema, 'space')} values ('spc-one', null), ('spc-deleted', now())`.execute(
      db
    );
    await sql`insert into ${sql.id(schema, 'base')} values
      ('bse-one', 'spc-one', null), ('bse-two', 'spc-one', null),
      ('bse-deleted', 'spc-one', now()), ('bse-deleted-space', 'spc-deleted', null),
      ('bse-missing-space', 'spc-missing', null), ('bse-template', 'spc-one', null),
      ('bse_literal%', 'spc-one', null)`.execute(db);
    await sql`insert into ${sql.id(schema, 'collaborator')} values
      ('c1', 'base', 'bse-one', 'usr-member', 'user', 'editor'),
      ('c2', 'space', 'spc-one', 'usr-space', 'user', 'viewer'),
      ('c3', 'base', 'bse-one', 'dep-parent', 'department', 'viewer'),
      ('c4', 'base', 'bse-two', 'appRobot', 'user', 'owner'),
      ('c5', 'base', 'bse-two', 'automationRobot', 'user', 'owner')`.execute(db);
    await sql`insert into ${sql.id(schema, 'template')} values
      ('tpl-one', ${JSON.stringify({ baseId: 'bse-template', other: { baseId: 'preserved' } })}),
      ('tpl-near', ${JSON.stringify({ baseId: 'bseXliteralAnything' })})`.execute(db);
    await sql`insert into ${sql.id(schema, 'access_token')} values
      ('pat-read', 'usr-member', null, '["record|read"]', null, '["bse-one"]', false),
      ('pat-space', 'usr-member', null, '["record|read"]', '["spc-one"]', null, false),
      ('pat-denied', 'usr-member', null, '["table|read"]', null, '["bse-one"]', false),
      ('pat-outside', 'usr-member', null, '["record|read"]', null, '["bse-two"]', false),
      ('pat-full', 'usr-member', null, '["record|read"]', null, null, true),
      ('oauth-read', 'usr-member', 'cltTestClient', '["record|read"]', null, null, true),
      ('oauth-denied', 'usr-member', 'cltTestClient', '["table|read"]', null, null, true),
      ('oauth-no-resource', 'usr-outsider', 'cltTestClient', '["record|read"]', '["spc-one"]', '["bse-one"]', true)`.execute(
      db
    );
  });

  afterAll(async () => {
    if (db) {
      await db.schema.dropSchema(schema).cascade().execute();
      await db.destroy();
    }
  });

  it('admits App reads with one statement against the selected metadata schema', async () => {
    statements.length = 0;
    const result = await admitDataQueryResource(metaDb, 'bse-one', app);
    expect(result).toEqual({
      spaceId: 'spc-one',
      permissions: getPermissions('owner'),
      binding: null,
    });
    expect(statements).toHaveLength(1);
  });

  it('preserves template permission semantics without wildcard matching ordinary bases', async () => {
    expect(
      await admitDataQueryResource(metaDb, 'bse-template', {
        ...app,
        tempAuthBaseId: 'bse-template',
      })
    ).toEqual({
      spaceId: 'spc-one',
      permissions: TemplatePermissions,
      template: { id: 'tpl-one', baseId: 'bse-template' },
      binding: null,
    });
    expect(
      await admitDataQueryResource(metaDb, 'bse_literal%', {
        ...app,
        tempAuthBaseId: 'bse_literal%',
      })
    ).toEqual({ spaceId: 'spc-one', permissions: getPermissions('owner'), binding: null });
  });

  it('rejects missing and deleted ancestry before any authority can admit it', async () => {
    for (const baseId of ['bse-missing', 'bse-deleted', 'bse-deleted-space', 'bse-missing-space']) {
      await expect(
        admitDataQueryResource(metaDb, baseId, { ...app, tempAuthBaseId: baseId })
      ).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it('resolves current user, space and department roles but never robot collaboration', async () => {
    expect((await admitDataQueryResource(metaDb, 'bse-one', user)).permissions).toEqual(
      getPermissions('editor')
    );
    expect(
      (await admitDataQueryResource(metaDb, 'bse-two', { actorId: 'usr-space', departmentIds: [] }))
        .permissions
    ).toEqual(getPermissions('viewer'));
    expect(
      (
        await admitDataQueryResource(metaDb, 'bse-one', {
          actorId: 'usr-department',
          departmentIds: ['dep-parent'],
        })
      ).permissions
    ).toEqual(getPermissions('viewer'));
    for (const actorId of ['usr-outsider', 'appRobot', 'automationRobot']) {
      await expect(
        admitDataQueryResource(metaDb, 'bse-two', {
          actorId,
          departmentIds: [],
          tempAuthBaseId: 'bse-one',
        })
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('intersects PAT scopes and resource ceilings with the current role', async () => {
    for (const accessTokenId of ['pat-read', 'pat-space', 'pat-full']) {
      expect(
        (await admitDataQueryResource(metaDb, 'bse-one', { ...user, accessTokenId })).permissions
      ).toEqual(['record|read']);
    }
    for (const accessTokenId of ['pat-denied', 'pat-outside']) {
      await expect(
        admitDataQueryResource(metaDb, 'bse-one', { ...user, accessTokenId })
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    await expect(
      admitDataQueryResource(metaDb, 'bse-one', { ...user, accessTokenId: 'pat-removed' })
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await metaDb.deleteFrom('collaborator').where('id', '=', 'c1').execute();
    try {
      await expect(
        admitDataQueryResource(metaDb, 'bse-one', { ...user, accessTokenId: 'pat-full' })
      ).rejects.toBeInstanceOf(ForbiddenException);
    } finally {
      await sql`insert into ${sql.id(schema, 'collaborator')} values ('c1', 'base', 'bse-one', 'usr-member', 'user', 'editor')`.execute(
        db
      );
    }
  });

  it('uses OAuth collaboration rather than PAT ranges or full-access flags', async () => {
    expect(
      (await admitDataQueryResource(metaDb, 'bse-one', { ...user, accessTokenId: 'oauth-read' }))
        .permissions
    ).toEqual(['record|read']);
    for (const accessTokenId of ['oauth-denied', 'oauth-no-resource']) {
      await expect(
        admitDataQueryResource(metaDb, 'bse-one', { ...user, accessTokenId })
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('retains department-only OAuth access without widening consented actions', async () => {
    const principal = {
      actorId: 'usr-outsider',
      departmentIds: ['dep-parent'],
      accessTokenId: 'oauth-no-resource',
    };
    expect((await admitDataQueryResource(metaDb, 'bse-one', principal)).permissions).toEqual([
      'record|read',
    ]);
    await expect(
      admitDataQueryResource(metaDb, 'bse-one', { ...principal, departmentIds: [] })
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      admitDataQueryResource(metaDb, 'bse-one', { ...principal, accessTokenId: 'oauth-denied' })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('loads routing state in the admission statement and drops stale default-mode connection details', async () => {
    await sql`insert into ${sql.id(schema, 'data_db_connection')} values
      ('dcn-one', 'ready', 'encrypted-url-fixture', 'tenant_internal', 'fingerprint', null, null)`.execute(
      db
    );
    await sql`insert into ${sql.id(schema, 'space_data_db_binding')} values
      ('sdb-one', 'spc-one', 'dcn-one', 'byodb', 'initializing')`.execute(db);
    try {
      statements.length = 0;
      const byodb = await admitDataQueryResource(metaDb, 'bse-one', app);
      expect(statements).toHaveLength(1);
      expect(byodb.binding).toMatchObject({
        mode: 'byodb',
        state: 'initializing',
        dataDbConnection: { id: 'dcn-one' },
      });
      await metaDb
        .updateTable('space_data_db_binding')
        .set({ mode: 'default' })
        .where('id', '=', 'sdb-one')
        .execute();
      const unbound = await admitDataQueryResource(metaDb, 'bse-one', app);
      expect(unbound.binding).toEqual({
        mode: 'default',
        state: 'initializing',
        dataDbConnection: null,
      });
      await metaDb
        .updateTable('space_data_db_binding')
        .set({ mode: 'byodb' })
        .where('id', '=', 'sdb-one')
        .execute();
      await metaDb.deleteFrom('data_db_connection').where('id', '=', 'dcn-one').execute();
      const missingConnection = await admitDataQueryResource(metaDb, 'bse-one', app);
      expect(missingConnection.binding).toEqual({
        mode: 'byodb',
        state: 'initializing',
        dataDbConnection: null,
      });
    } finally {
      await metaDb.deleteFrom('space_data_db_binding').where('id', '=', 'sdb-one').execute();
      await metaDb.deleteFrom('data_db_connection').where('id', '=', 'dcn-one').execute();
    }
  });
});
