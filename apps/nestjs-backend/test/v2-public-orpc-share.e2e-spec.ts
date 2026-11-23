import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import { disableShareView, enableShareView, updateViewColumnMeta, updateViewShareMeta } from '@teable/openapi';
import type { ITableFullVo } from '@teable/openapi';
import { createRecords, createTable, initApp, permanentDeleteTable } from './utils/init-app';
import { requestPublicOrpc, responseCookie, signInPublicHost } from './utils/public-orpc';

describe('public oRPC share capability isolation', () => {
  let app: INestApplication;
  let appUrl: string;
  let ownerCookie: string;
  let table: ITableFullVo;
  let victim: ITableFullVo;
  let shareId: string;
  let victimShareId: string;
  let cookie: string;
  let recordId: string;
  let victimRecordId: string;
  const call = (path: string, input: Record<string, unknown>, headers: HeadersInit = {}) =>
    requestPublicOrpc(appUrl, `/share/${path}`, input, { headers });

  beforeAll(async () => {
    ({ app, appUrl } = await initApp());
    ownerCookie = await signInPublicHost(appUrl);
    table = await createTable(globalThis.testConfig.baseId, {
      records: [],
      name: 'public share attacker', fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Hidden secret', type: FieldType.SingleLineText },
      ],
    });
    victim = await createTable(globalThis.testConfig.baseId, {
      records: [],
      name: 'public share victim', fields: [{ name: 'Private', type: FieldType.SingleLineText }],
    });
    recordId = (await createRecords(table.id, { fieldKeyType: FieldKeyType.Id,
      records: [{ fields: { [table.fields[0].id]: 'public value', [table.fields[1].id]: 'hidden-cell-secret' } }] })).records[0].id;
    victimRecordId = (await createRecords(victim.id, { fieldKeyType: FieldKeyType.Id,
      records: [{ fields: { [victim.fields[0].id]: 'private value' } }] })).records[0].id;
    shareId = (await enableShareView({ tableId: table.id, viewId: table.views[0].id })).data.shareId;
    victimShareId = (await enableShareView({ tableId: victim.id, viewId: victim.views[0].id })).data.shareId;
    await updateViewShareMeta(table.id, table.views[0].id, {
      password: 'public-own-password', includeHiddenField: false, includeRecords: true,
    });
    await updateViewColumnMeta(table.id, table.views[0].id, [
      { fieldId: table.fields[1].id, columnMeta: { hidden: true } },
    ]);
    await updateViewShareMeta(victim.id, victim.views[0].id, { password: 'private-victim-password' });
    const auth = await call('authenticate', { shareId, password: 'public-own-password' });
    expect(auth.status).toBe(200);
    cookie = responseCookie(auth);
  });
  afterAll(async () => {
    try {
      if (table) await permanentDeleteTable(globalThis.testConfig.baseId, table.id);
      if (victim) await permanentDeleteTable(globalThis.testConfig.baseId, victim.id);
    } finally { await app?.close(); }
  });

  it('requires the share password independently of an owner login', async () => {
    for (const headers of [{}, { cookie: ownerCookie }]) {
      expect((await call('get', { shareId }, headers)).status).toBe(401);
    }
    expect((await call('authenticate', { shareId, password: 'wrong-password' })).status).toBe(401);
  });

  it('does not grant member capabilities to a genuine share visitor', async () => {
    const response = await requestPublicOrpc(appUrl, '/tables/get', {
      baseId: globalThis.testConfig.baseId, tableId: table.id,
    }, { method: 'GET', headers: { cookie } });
    expect(response.status).toBe(401);
  });

  it('returns the public allowlist without credentials, host metadata or computation diagnostics', async () => {
    const response = await call('get', { shareId }, { cookie });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.view).toMatchObject({ id: table.views[0].id });
    const serialized = JSON.stringify(body);
    for (const forbidden of ['public-own-password', 'password', 'dbTableName', 'dbFieldName',
      'computed_update_outbox', 'deadLetter', 'traceId', 'createdBy', 'lastModifiedBy']) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it('cannot reuse or rename another share cookie to access a protected share', async () => {
    expect((await call('get', { shareId: victimShareId }, { cookie })).status).toBe(401);
    const token = cookie.split('; ').find((part) => part.startsWith(`${shareId}=`))?.slice(shareId.length + 1);
    expect(token).toBeTruthy();
    expect((await call('get', { shareId: victimShareId }, {
      cookie: `${victimShareId}=${token}`,
    })).status).toBe(401);
  });

  it('cannot select a record outside the shared table', async () => {
    const allowed = await call('getRecord', { shareId, recordId }, { cookie });
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).data.id).toBe(recordId);
    const denied = await call('getRecord', { shareId, recordId: victimRecordId }, { cookie });
    expect(denied.status).toBe(404);
    expect(await denied.text()).not.toContain('private value');
  });

  it('excludes hidden cells and rejects hidden-field projections, filters and aggregates', async () => {
    const listed = await call('listRecords', { shareId }, { cookie });
    expect(listed.status).toBe(200);
    const records = (await listed.json()).data.records;
    expect(records).toHaveLength(1);
    expect(records[0].fields).not.toHaveProperty(table.fields[1].id);
    expect(JSON.stringify(records)).not.toContain('hidden-cell-secret');
    for (const [path, input] of [
      ['listRecords', { projection: [table.fields[1].id] }],
      ['countRecords', { filter: { fieldId: table.fields[1].id, operator: 'is', value: 'hidden-cell-secret' } }],
      ['aggregateRecords', { metrics: [{ fieldId: table.fields[1].id, statisticFunc: 'count' }] }],
      ['copy', { projection: [table.fields[1].id] }],
    ] as const) {
      const denied = await call(path, { shareId, ...input }, { cookie });
      expect(denied.status, path).toBe(403);
      expect(await denied.text()).not.toContain('hidden-cell-secret');
    }
  });

  it('rejects table routing, execution context and unknown capability overrides', async () => {
    for (const extra of [{ tableId: victim.id }, { baseId: globalThis.testConfig.baseId },
      { actorId: globalThis.testConfig.userId }, { token: 'not-a-cookie' }]) {
      const response = await call('listRecords', { shareId, ...extra }, { cookie });
      expect(response.status).toBe(400);
    }
  });

  it('denies all writes when the actual shared view is read-only', async () => {
    for (const [path, input] of [
      ['submitRecord', { fields: { [table.fields[0].id]: 'forbidden' } }],
      ['createRecords', { records: [{ fields: { [table.fields[0].id]: 'forbidden' } }] }],
      ['updateRecord', { recordId, fields: { [table.fields[0].id]: 'forbidden' } }],
      ['deleteRecords', { recordIds: [recordId] }],
    ] as const) {
      expect((await call(path, { shareId, ...input }, { cookie })).status, path).toBe(403);
    }
    const read = await call('getRecord', { shareId, recordId }, { cookie });
    expect(read.status).toBe(200);
    expect((await read.json()).data.fields[table.fields[0].id]).toBe('public value');
  });

  it('revokes an already authenticated visitor when the owner disables the share', async () => {
    await disableShareView({ tableId: table.id, viewId: table.views[0].id });
    expect((await call('get', { shareId }, { cookie })).status).toBe(404);
    expect((await call('listRecords', { shareId }, { cookie })).status).toBe(404);
  });
});
