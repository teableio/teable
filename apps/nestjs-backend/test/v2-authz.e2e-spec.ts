import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { createRecords, createTable, initApp, permanentDeleteTable } from './utils/init-app';

/**
 * The v2 ORPC procedures resolve the target base/table from the request body
 * or query, so the global PermissionGuard must be told where to find it.
 * Without the @Permissions/@ResourceMeta metadata any signed-in user could
 * read, create and mutate tables in bases they are not a member of.
 */
describe('V2Controller authorization (e2e)', () => {
  let app: INestApplication;
  let appUrl: string;
  let ownerCookie: string;
  let outsiderCookie: string;
  let tableId: string;
  let recordId: string;

  const baseId = globalThis.testConfig.baseId;

  const asCookieHeader = (value: unknown) =>
    Array.isArray(value) ? value.join('; ') : String(value ?? '');

  const call = (
    cookie: string,
    path: string,
    init: { method: 'GET' | 'POST' | 'DELETE'; body?: Record<string, unknown> }
  ) =>
    fetch(`${appUrl}/api/v2${path}`, {
      method: init.method,
      headers: { cookie, ['content-type']: 'application/json' },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    appUrl = appCtx.appUrl;
    ownerCookie = appCtx.cookie;

    const outsider = await createNewUserAxios({
      email: `v2-outsider-${Date.now()}@example.com`,
      password: '12345678',
    });
    outsiderCookie = asCookieHeader(outsider.defaults.headers.Cookie);

    const table = await createTable(baseId, {
      name: 'v2 authz',
      fields: [{ name: 'Title', type: FieldType.SingleLineText, isPrimary: true }],
    });
    tableId = table.id;
    const titleFieldId = table.fields[0].id;
    const created = await createRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      records: [{ fields: { [titleFieldId]: 'keep me' } }],
    });
    recordId = created.records[0].id;
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, tableId);
    await app.close();
  });

  it('rejects a non-collaborator reading a table by id', async () => {
    const response = await call(outsiderCookie, `/tables/get?baseId=${baseId}&tableId=${tableId}`, {
      method: 'GET',
    });
    expect(response.status).toBe(403);
  });

  it('rejects a non-collaborator creating a table in the base', async () => {
    const response = await call(outsiderCookie, '/tables/create', {
      method: 'POST',
      body: { baseId, name: 'planted' },
    });
    expect(response.status).toBe(403);
  });

  it('rejects a non-collaborator updating records', async () => {
    const response = await call(outsiderCookie, '/tables/updateRecords', {
      method: 'POST',
      body: { tableId, recordIds: [recordId], fields: {} },
    });
    expect(response.status).toBe(403);
  });

  it('rejects a non-collaborator deleting records', async () => {
    const response = await call(outsiderCookie, '/tables/deleteRecords', {
      method: 'DELETE',
      body: { tableId, recordIds: [recordId] },
    });
    expect(response.status).toBe(403);
  });

  it('still serves the base owner', async () => {
    const get = await call(ownerCookie, `/tables/get?baseId=${baseId}&tableId=${tableId}`, {
      method: 'GET',
    });
    expect(get.status).toBe(200);

    const create = await call(ownerCookie, '/tables/create', {
      method: 'POST',
      body: { baseId, name: 'v2 authz owner' },
    });
    expect(create.status).toBe(201);
    const createdTableId =
      (await create.json()).data?.table?.id ?? (await Promise.resolve(undefined));
    if (createdTableId) await permanentDeleteTable(baseId, createdTableId);

    const del = await call(ownerCookie, '/tables/deleteRecords', {
      method: 'DELETE',
      body: { tableId, recordIds: [recordId] },
    });
    expect(del.status).toBe(200);
  });
});
