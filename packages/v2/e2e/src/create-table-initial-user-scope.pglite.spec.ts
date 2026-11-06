/* eslint-disable @typescript-eslint/naming-convention */
import {
  createTableOkResponseSchema,
  createTablesOkResponseSchema,
} from '@teable/v2-contract-http';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const allowedCollaborator = {
  id: 'usrT8238InitialMember',
  name: 'T8238 Initial Member',
  email: 't8238-initial-member@example.invalid',
};
const platformOutsider = {
  id: 'usrT8238InitialOutsider',
  name: 'T8238 Initial Outsider',
  email: 't8238-initial-outsider@example.invalid',
};
const syntheticUserIds = [allowedCollaborator.id, platformOutsider.id];
const tableIds = {
  createTableRejected: `tbl${'initialRejectOne'.padEnd(16, '0').slice(0, 16)}`,
  createTableAllowed: `tbl${'initialAllowOne'.padEnd(16, '0').slice(0, 16)}`,
  createTableOutsiderAllowed: `tbl${'initialPairOne'.padEnd(16, '0').slice(0, 16)}`,
  createTableOutsiderMismatch: `tbl${'initialMismatch1'.padEnd(16, '0').slice(0, 16)}`,
  createTablesRejected: `tbl${'initialRejectMany'.padEnd(16, '0').slice(0, 16)}`,
  createTablesAllowed: `tbl${'initialAllowMany'.padEnd(16, '0').slice(0, 16)}`,
  createTablesOutsiderAllowed: `tbl${'initialPairMany'.padEnd(16, '0').slice(0, 16)}`,
  createTablesOutsiderMismatch: `tbl${'initialMismatchN'.padEnd(16, '0').slice(0, 16)}`,
};

const fieldId = (suffix: string) => `fld${suffix.padEnd(16, '0').slice(0, 16)}`;

type HttpResult = { status: number; body: unknown };

describe('v2 HTTP table initial user scope (PGlite)', () => {
  let ctx: SharedTestContext;

  const post = async (path: string, body: unknown): Promise<HttpResult> => {
    const response = await fetch(`${ctx.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };

  const removeSyntheticAccounts = async () => {
    await ctx.testContainer.db
      .deleteFrom('collaborator')
      .where('principal_id', 'in', syntheticUserIds)
      .execute();
    await ctx.testContainer.db.deleteFrom('users').where('id', 'in', syntheticUserIds).execute();
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'pglite' });
    await removeSyntheticAccounts();
    await ctx.testContainer.db
      .insertInto('users')
      .values([allowedCollaborator, platformOutsider])
      .execute();
    await ctx.testContainer.db
      .insertInto('collaborator')
      .values({
        id: 'colT8238InitialMember',
        resource_type: 'base',
        resource_id: ctx.baseId,
        principal_id: allowedCollaborator.id,
        principal_type: 'user',
      })
      .execute();
  });

  afterAll(async () => {
    for (const tableId of Object.values(tableIds)) {
      await ctx.deleteTable(tableId).catch(() => undefined);
    }
    if (ctx) await removeSyntheticAccounts();
  });

  test('createTable rejects a platform outsider in initial records', async () => {
    const nameFieldId = fieldId('initialNameOne');
    const ownerFieldId = fieldId('initialOwnerOne');
    const rejected = await post('/tables/create', {
      baseId: ctx.baseId,
      tableId: tableIds.createTableRejected,
      name: 'T8238 createTable outsider initial record',
      fields: [
        { id: nameFieldId, type: 'singleLineText', name: 'Name', isPrimary: true },
        { id: ownerFieldId, type: 'user', name: 'Owner', options: { isMultiple: false } },
      ],
      records: [
        {
          fields: {
            [nameFieldId]: 'forged outsider',
            [ownerFieldId]: { id: platformOutsider.id },
          },
        },
      ],
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body).toMatchObject({
      ok: false,
      error: {
        code: 'validation.field.user_not_found',
        message: 'User not found',
      },
    });
  });

  test('createTable preserves an allowed collaborator in initial records', async () => {
    const nameFieldId = fieldId('initialNameAllow');
    const ownerFieldId = fieldId('initialOwnerAllow');
    const response = await post('/tables/create', {
      baseId: ctx.baseId,
      tableId: tableIds.createTableAllowed,
      name: 'T8238 createTable allowed initial record',
      fields: [
        { id: nameFieldId, type: 'singleLineText', name: 'Name', isPrimary: true },
        { id: ownerFieldId, type: 'user', name: 'Owner', options: { isMultiple: false } },
      ],
      records: [
        {
          fields: {
            [nameFieldId]: 'allowed collaborator',
            [ownerFieldId]: { id: allowedCollaborator.id },
          },
        },
      ],
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(createTableOkResponseSchema.safeParse(response.body).success).toBe(true);
    const records = await ctx.listRecordsWithoutDrain(tableIds.createTableAllowed);
    expect(records).toHaveLength(1);
    expect(records[0]?.fields[ownerFieldId]).toMatchObject({
      id: allowedCollaborator.id,
      title: allowedCollaborator.name,
      email: allowedCollaborator.email,
    });
  });

  test('createTable canonicalizes a platform outsider with a matching id and email', async () => {
    const nameFieldId = fieldId('initialNamePair1');
    const ownerFieldId = fieldId('initialOwnerPair');
    const response = await post('/tables/create', {
      baseId: ctx.baseId,
      tableId: tableIds.createTableOutsiderAllowed,
      name: 'T8238 createTable canonical outsider pair',
      fields: [
        { id: nameFieldId, type: 'singleLineText', name: 'Name', isPrimary: true },
        { id: ownerFieldId, type: 'user', name: 'Owner', options: { isMultiple: false } },
      ],
      records: [
        {
          fields: {
            [nameFieldId]: 'canonical outsider pair',
            [ownerFieldId]: { id: platformOutsider.id, email: platformOutsider.email },
          },
        },
      ],
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(createTableOkResponseSchema.safeParse(response.body).success).toBe(true);
    const records = await ctx.listRecordsWithoutDrain(tableIds.createTableOutsiderAllowed);
    expect(records).toHaveLength(1);
    expect(records[0]?.fields[ownerFieldId]).toMatchObject({
      id: platformOutsider.id,
      title: platformOutsider.name,
      email: platformOutsider.email,
    });
  });

  test('createTable rejects a mismatched pair without exposing or persisting the record', async () => {
    const nameFieldId = fieldId('initialNameBad1');
    const ownerFieldId = fieldId('initialOwnerBad1');
    const rejected = await post('/tables/create', {
      baseId: ctx.baseId,
      tableId: tableIds.createTableOutsiderMismatch,
      name: 'T8238 createTable mismatched outsider pair',
      fields: [
        { id: nameFieldId, type: 'singleLineText', name: 'Name', isPrimary: true },
        { id: ownerFieldId, type: 'user', name: 'Owner', options: { isMultiple: false } },
      ],
      records: [
        {
          fields: {
            [nameFieldId]: 'mismatched outsider pair',
            [ownerFieldId]: {
              id: platformOutsider.id,
              email: 'wrong-initial-outsider@example.invalid',
            },
          },
        },
      ],
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body).toMatchObject({
      ok: false,
      error: {
        code: 'validation.field.user_not_found',
        message: 'User not found',
      },
    });
    const tableMeta = await ctx.testContainer.db
      .selectFrom('table_meta')
      .select(['id', 'provision_state', 'db_table_name'])
      .where('id', '=', tableIds.createTableOutsiderMismatch)
      .executeTakeFirstOrThrow();
    expect(tableMeta.provision_state).toBe('error');
    const get = await fetch(
      `${ctx.baseUrl}/tables/get?${new URLSearchParams({ baseId: ctx.baseId, tableId: tableMeta.id })}`
    );
    expect(get.status).toBe(404);
    expect(JSON.stringify(await get.json())).not.toContain(platformOutsider.email);
    const listed = await ctx.listTables();
    expect(listed.some((table) => table.id === tableMeta.id)).toBe(false);
    const physical = await sql<{
      relation: string | null;
    }>`select to_regclass(${tableMeta.db_table_name})::text as relation`.execute(
      ctx.testContainer.db
    );
    expect(physical.rows[0]?.relation).toBeNull();
  });

  test('createTables rejects a platform outsider in initial records', async () => {
    const nameFieldId = fieldId('initialNameMany');
    const ownerFieldId = fieldId('initialOwnerMany');
    const rejected = await post('/tables/createTables', {
      baseId: ctx.baseId,
      tables: [
        {
          tableId: tableIds.createTablesRejected,
          name: 'T8238 createTables outsider initial record',
          fields: [
            { id: nameFieldId, type: 'singleLineText', name: 'Name', isPrimary: true },
            { id: ownerFieldId, type: 'user', name: 'Owner', options: { isMultiple: false } },
          ],
          records: [
            {
              fields: {
                [nameFieldId]: 'forged outsider',
                [ownerFieldId]: { id: platformOutsider.id },
              },
            },
          ],
        },
      ],
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body).toMatchObject({
      ok: false,
      error: {
        code: 'validation.field.user_not_found',
        message: 'User not found',
      },
    });
  });

  test('createTables preserves an allowed collaborator in initial records', async () => {
    const nameFieldId = fieldId('initialNameBatch');
    const ownerFieldId = fieldId('initialOwnerBatch');
    const response = await post('/tables/createTables', {
      baseId: ctx.baseId,
      tables: [
        {
          tableId: tableIds.createTablesAllowed,
          name: 'T8238 createTables allowed initial record',
          fields: [
            { id: nameFieldId, type: 'singleLineText', name: 'Name', isPrimary: true },
            { id: ownerFieldId, type: 'user', name: 'Owner', options: { isMultiple: false } },
          ],
          records: [
            {
              fields: {
                [nameFieldId]: 'allowed collaborator',
                [ownerFieldId]: { id: allowedCollaborator.id },
              },
            },
          ],
        },
      ],
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(createTablesOkResponseSchema.safeParse(response.body).success).toBe(true);
    const records = await ctx.listRecordsWithoutDrain(tableIds.createTablesAllowed);
    expect(records).toHaveLength(1);
    expect(records[0]?.fields[ownerFieldId]).toMatchObject({
      id: allowedCollaborator.id,
      title: allowedCollaborator.name,
      email: allowedCollaborator.email,
    });
  });

  test('createTables canonicalizes a platform outsider with a matching id and email', async () => {
    const nameFieldId = fieldId('initialNamePairN');
    const ownerFieldId = fieldId('initialOwnrPairN');
    const response = await post('/tables/createTables', {
      baseId: ctx.baseId,
      tables: [
        {
          tableId: tableIds.createTablesOutsiderAllowed,
          name: 'T8238 createTables canonical outsider pair',
          fields: [
            { id: nameFieldId, type: 'singleLineText', name: 'Name', isPrimary: true },
            { id: ownerFieldId, type: 'user', name: 'Owner', options: { isMultiple: false } },
          ],
          records: [
            {
              fields: {
                [nameFieldId]: 'canonical outsider pair',
                [ownerFieldId]: { id: platformOutsider.id, email: platformOutsider.email },
              },
            },
          ],
        },
      ],
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(createTablesOkResponseSchema.safeParse(response.body).success).toBe(true);
    const records = await ctx.listRecordsWithoutDrain(tableIds.createTablesOutsiderAllowed);
    expect(records).toHaveLength(1);
    expect(records[0]?.fields[ownerFieldId]).toMatchObject({
      id: platformOutsider.id,
      title: platformOutsider.name,
      email: platformOutsider.email,
    });
  });

  test('createTables rejects a mismatched pair without exposing or persisting the record', async () => {
    const nameFieldId = fieldId('initialNameBadN');
    const ownerFieldId = fieldId('initialOwnerBadN');
    const rejected = await post('/tables/createTables', {
      baseId: ctx.baseId,
      tables: [
        {
          tableId: tableIds.createTablesOutsiderMismatch,
          name: 'T8238 createTables mismatched outsider pair',
          fields: [
            { id: nameFieldId, type: 'singleLineText', name: 'Name', isPrimary: true },
            { id: ownerFieldId, type: 'user', name: 'Owner', options: { isMultiple: false } },
          ],
          records: [
            {
              fields: {
                [nameFieldId]: 'mismatched outsider pair',
                [ownerFieldId]: {
                  id: platformOutsider.id,
                  email: 'wrong-initial-outsider@example.invalid',
                },
              },
            },
          ],
        },
      ],
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body).toMatchObject({
      ok: false,
      error: {
        code: 'validation.field.user_not_found',
        message: 'User not found',
      },
    });
    const tableMeta = await ctx.testContainer.db
      .selectFrom('table_meta')
      .select(['id', 'provision_state', 'db_table_name'])
      .where('id', '=', tableIds.createTablesOutsiderMismatch)
      .executeTakeFirstOrThrow();
    expect(tableMeta.provision_state).toBe('error');
    const get = await fetch(
      `${ctx.baseUrl}/tables/get?${new URLSearchParams({ baseId: ctx.baseId, tableId: tableMeta.id })}`
    );
    expect(get.status).toBe(404);
    expect(JSON.stringify(await get.json())).not.toContain(platformOutsider.email);
    const listed = await ctx.listTables();
    expect(listed.some((table) => table.id === tableMeta.id)).toBe(false);
    const physical = await sql<{
      relation: string | null;
    }>`select to_regclass(${tableMeta.db_table_name})::text as relation`.execute(
      ctx.testContainer.db
    );
    expect(physical.rows[0]?.relation).toBeNull();
  });
});
