import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, Role } from '@teable/core';
import {
  CREATE_ACCESS_TOKEN,
  createAccessToken,
  deleteAccessToken,
  emailBaseInvitation,
  generateOAuthSecret,
  oauthCreate,
  oauthDelete,
} from '@teable/openapi';
import type { CreateAccessTokenRo, CreateAccessTokenVo, ITableFullVo } from '@teable/openapi';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import {
  createBase,
  createRecords,
  createSpace,
  createTable,
  initApp,
  permanentDeleteSpace,
  permanentDeleteTable,
} from './utils/init-app';
import { requestPublicOrpc, sessionCookie, signInPublicHost } from './utils/public-orpc';

/** Public transport tests deliberately use persisted sessions and issued bearer tokens. */
describe('public oRPC identity, resource and nested authorization', () => {
  let app: INestApplication;
  let appUrl: string;
  let cookie: string;
  let outsiderCookie: string;
  let viewerCookie: string;
  let viewerPat: string;
  let readPat: string;
  let writePat: string;
  let spaceId: string;
  let baseId: string;
  let otherBaseId: string;
  let table: ITableFullVo;
  let otherTable: ITableFullVo;
  let recordId: string;
  let otherRecordId: string;
  let oauthClientId: string | undefined;
  const tokenIds: string[] = [];
  const call = (path: string, input: Record<string, unknown>, headers: HeadersInit = { cookie }, method: 'GET' | 'POST' | 'DELETE' = 'POST') =>
    requestPublicOrpc(appUrl, path, input, { headers, method });
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const expiry = () => new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    ({ app, appUrl } = await initApp());
    cookie = await signInPublicHost(appUrl);
    ({ id: spaceId } = await createSpace({ name: 'public orpc auth' }));
    ({ id: baseId } = await createBase({ spaceId, name: 'permitted' }));
    ({ id: otherBaseId } = await createBase({ spaceId, name: 'outside token ceiling' }));
    const fields = [{ name: 'Name', type: FieldType.SingleLineText }];
    table = await createTable(baseId, { name: 'authorized records', fields });
    otherTable = await createTable(otherBaseId, { name: 'foreign records', fields });
    const created = await createRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [{ fields: { [table.fields[0].id]: 'original' } }],
    });
    recordId = created.records[0].id;
    const foreign = await createRecords(otherTable.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [{ fields: { [otherTable.fields[0].id]: 'foreign' } }],
    });
    otherRecordId = foreign.records[0].id;
    const outsider = await createNewUserAxios({ email: `public-orpc-outsider-${Date.now()}@example.com`, password: '12345678' });
    outsiderCookie = sessionCookie(outsider.defaults.headers.Cookie);
    const viewerEmail = `public-orpc-viewer-${Date.now()}@example.com`;
    const viewer = await createNewUserAxios({ email: viewerEmail, password: '12345678' });
    viewerCookie = sessionCookie(viewer.defaults.headers.Cookie);
    await emailBaseInvitation({ baseId, emailBaseInvitationRo: { emails: [viewerEmail], role: Role.Viewer } });
    const viewerToken = await viewer.post<CreateAccessTokenVo>(CREATE_ACCESS_TOKEN, {
      name: 'viewer scoped write request', description: 'role ceiling',
      scopes: ['table|read', 'record|read', 'record|update'],
      baseIds: [baseId], expiredTime: expiry(),
    });
    viewerPat = viewerToken.data.token;
    // This token belongs to the viewer and must be revoked through their genuine session.
    viewerCleanup = async () => { await viewer.delete(`/access-token/${viewerToken.data.id}`); };
    const tokenScopes: CreateAccessTokenRo['scopes'][] = [
      ['table|read', 'record|read'],
      ['table|read', 'record|read', 'record|update', 'table|create', 'field|create'],
    ];
    for (const scopes of tokenScopes) {
      const token = (await createAccessToken({
        name: 'public orpc scoped token', description: 'auth parity', scopes,
        baseIds: [baseId], expiredTime: expiry(),
      })).data;
      tokenIds.push(token.id);
      if (scopes.includes('record|update')) writePat = token.token;
      else readPat = token.token;
    }
  });
  let viewerCleanup: (() => Promise<void>) | undefined;
  afterAll(async () => {
    try {
      if (oauthClientId) await oauthDelete(oauthClientId);
      for (const id of tokenIds) await deleteAccessToken(id);
      await viewerCleanup?.();
      if (spaceId) await permanentDeleteSpace(spaceId);
    } finally { await app?.close(); }
  });

  it('requires real authentication on newly mounted queries and metadata procedures', async () => {
    for (const [path, extra] of [
      ['/tables/get', { baseId }], ['/tables/listRecords', {}], ['/tables/getRecord', { recordId }],
      ['/tables/listViews', {}], ['/tables/getView', { viewId: table.views[0].id }],
      ['/tables/getComputeActivity', { baseId }], ['/tables/getViewSnapshots', { viewIds: [table.views[0].id] }],
      ['/tables/listViewDocIds', {}],
    ] as const) {
      const response = await call(path, { tableId: table.id, ...extra }, {}, 'GET');
      expect(response.status, path).toBe(401);
    }
  });

  it('checks collaborator membership for every query family before returning diagnostics', async () => {
    for (const [path, extra] of [
      ['/tables/get', { baseId }], ['/tables/listRecords', {}], ['/tables/getRecord', { recordId }],
      ['/tables/listViews', {}], ['/tables/getView', { viewId: table.views[0].id }],
      ['/tables/getComputeActivity', { baseId }], ['/tables/getViewSnapshots', { viewIds: [table.views[0].id] }],
      ['/tables/listViewDocIds', {}],
    ] as const) {
      const response = await call(path, { tableId: table.id, ...extra }, { cookie: outsiderCookie }, 'GET');
      expect(response.status, path).toBe(403);
      const body = await response.text();
      expect(body).not.toContain('dbTableName');
      expect(body).not.toContain('dbFieldName');
      expect(body).not.toContain('computed_update_outbox');
    }
  });

  it('serves both genuine session and PAT reads through the same public contract', async () => {
    for (const headers of [{ cookie }, bearer(readPat)]) {
      const response = await call('/tables/listRecords', { baseId, tableId: table.id }, headers, 'GET');
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.data.records).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: recordId, fields: expect.objectContaining({ [table.fields[0].id]: 'original' }) }),
      ]));
    }
  });

  it('enforces PAT action scope and actual viewer role even when the token asks for write', async () => {
    for (const headers of [bearer(readPat), bearer(viewerPat), { cookie: viewerCookie }]) {
      const response = await call('/tables/updateRecords', {
        tableId: table.id, records: [{ id: recordId, fields: { [table.fields[0].id]: 'forbidden' } }],
      }, headers);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ ok: false, error: expect.stringMatching(/\S/) });
    }
    const response = await call('/tables/getRecord', { tableId: table.id, recordId }, { cookie }, 'GET');
    expect(response.status).toBe(200);
    expect((await response.json()).data.record.fields[table.fields[0].id]).toBe('original');
  });

  it('checks the resolved table resource and cannot be confused by an allowed baseId', async () => {
    for (const input of [
      { baseId: otherBaseId, tableId: otherTable.id },
      { baseId, tableId: otherTable.id },
    ]) {
      const response = await call('/tables/get', input, bearer(readPat), 'GET');
      expect(response.status).toBe(403);
    }
    const mismatch = await call('/tables/getRecord', { tableId: table.id, recordId: otherRecordId }, { cookie }, 'GET');
    expect(mismatch.status).toBe(404);
  });

  it('rejects nested cross-base link access before creating any table', async () => {
    const name = `must not partially create-${Date.now()}`;
    const response = await call('/tables/createTables', {
      baseId,
      tables: [{ name, fields: [
        { type: 'singleLineText', name: 'Name' },
        { type: 'link', name: 'Unauthorized foreign link', options: {
          baseId: otherBaseId, foreignTableId: otherTable.id, relationship: 'manyMany', isOneWay: true,
        } },
      ] }],
    }, bearer(writePat));
    expect(response.status).toBe(403);
    const tables = await call('/tables/list', { baseId }, { cookie }, 'GET');
    expect(tables.status).toBe(200);
    expect(JSON.stringify(await tables.json())).not.toContain(name);
  });

  it('rejects a foreign view paired with an allowed table', async () => {
    const response = await call('/tables/getView', {
      tableId: table.id, viewId: otherTable.views[0].id,
    }, bearer(readPat), 'GET');
    expect(response.status).toBe(404);
  });

  it('retains authorized native computed metadata and removes whole fields with denied foreign dependencies', async () => {
    const host = await createTable(baseId, { name: 'native dependency metadata host',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }], records: [] });
    const targets = [];
    for (const allowed of [true, false]) {
      const targetBaseId = allowed ? baseId : otherBaseId;
      const target = await createTable(targetBaseId, { name: `metadata dependency ${allowed}`,
        fields: [{ name: 'Name', type: FieldType.SingleLineText }, { name: 'Amount', type: FieldType.Number },
          { name: 'Status', type: FieldType.SingleLineText }], records: [] });
      const marker = allowed ? 'authorized-metadata-filter' : 'denied-metadata-filter';
      const filter = { conjunction: 'and', filterSet: [{ fieldId: target.fields[2].id, operator: 'is', value: marker }] };
      const add = async (field: Record<string, unknown>) => {
        const response = await call('/tables/createField', { baseId, tableId: host.id, field });
        expect(response.status, await response.clone().text()).toBe(200);
        const fields = (await response.json()).data.table.fields;
        const created = fields.find((item: { name: string }) => item.name === field.name);
        expect(created).toBeDefined();
        return created;
      };
      const link = await add({ name: `metadata link ${allowed}`, type: 'link', options: {
        baseId: targetBaseId, foreignTableId: target.id, lookupFieldId: target.fields[0].id,
        relationship: 'manyMany', isOneWay: true } });
      const conditionalLookup = await add({ name: `native conditional lookup ${allowed}`, type: 'conditionalLookup',
        options: { baseId: targetBaseId, foreignTableId: target.id, lookupFieldId: target.fields[1].id,
          condition: { filter } } });
      const rollup = await add({ name: `native rollup ${allowed}`, type: 'rollup',
        options: { expression: 'sum({values})' }, config: { linkFieldId: link.id,
          foreignTableId: target.id, lookupFieldId: target.fields[1].id, filter } });
      const conditionalRollup = await add({ name: `native conditional rollup ${allowed}`, type: 'conditionalRollup',
        options: { expression: 'sum({values})' }, config: { baseId: targetBaseId,
          foreignTableId: target.id, lookupFieldId: target.fields[1].id, condition: { filter } } });
      expect(conditionalLookup.conditionalLookupOptions.foreignTableId).toBe(target.id);
      expect(rollup.config.foreignTableId).toBe(target.id);
      expect(conditionalRollup.config.foreignTableId).toBe(target.id);
      targets.push({ allowed, target, marker, fields: [link, conditionalLookup, rollup, conditionalRollup] });
    }
    const issued = (await createAccessToken({ name: 'native metadata base ceiling', description: 'conditional config redaction',
      scopes: ['table|read', 'field|read', 'record|read'], baseIds: [baseId], expiredTime: expiry() })).data;
    tokenIds.push(issued.id);
    const ownerRead = await call('/tables/get', { baseId, tableId: host.id }, { cookie }, 'GET');
    expect(ownerRead.status).toBe(200);
    const ownerTable = (await ownerRead.json()).data.table;
    const scopedRead = await call('/tables/get', { baseId, tableId: host.id }, bearer(issued.token), 'GET');
    expect(scopedRead.status).toBe(200);
    const scopedTable = (await scopedRead.json()).data.table;
    const serialized = JSON.stringify(scopedTable);
    for (const fixture of targets) {
      for (const field of fixture.fields) {
        const full = ownerTable.fields.find((item: { id: string }) => item.id === field.id);
        expect(full).toBeDefined();
        const scoped = scopedTable.fields.find((item: { id: string }) => item.id === field.id);
        if (fixture.allowed) expect(scoped).toEqual(full);
        else {
          expect(scoped).toBeUndefined();
          expect(serialized).not.toContain(field.id);
        }
      }
      if (!fixture.allowed) {
        expect(serialized).not.toContain(fixture.target.id);
        for (const field of fixture.target.fields) expect(serialized).not.toContain(field.id);
        expect(serialized).not.toContain(fixture.marker);
      }
    }
  });

  it('separates share-only permission from mixed view changes and redacts snapshot credentials', async () => {
    const created = await call('/tables/createView', { tableId: table.id,
      view: { name: 'real sharing permission fixture', type: 'grid' } });
    expect(created.status, await created.clone().text()).toBe(200);
    const viewId = (await created.json()).data.viewId;
    const enabled = await call('/tables/enableViewShare', { tableId: table.id, viewId });
    expect(enabled.status).toBe(200);
    const shareId = (await enabled.json()).data.shareId;
    const issue = async (name: string, actions: string[]) => {
      const token = (await createAccessToken({ name, description: 'real view permission ceiling',
        scopes: ['table|read', 'view|read', ...actions], baseIds: [baseId], expiredTime: expiry() })).data;
      tokenIds.push(token.id);
      return token.token;
    };
    const shareOnly = await issue('share only, no view update', ['view|share']);
    const updateOnly = await issue('view update only, no share', ['view|update']);
    const both = await issue('view update and share', ['view|update', 'view|share']);
    const reader = await issue('view reader without sharing', []);
    const password = 'original-private-share-password';
    const shareOnlyResponse = await call('/tables/updateViewShareMeta', { tableId: table.id, viewId,
      shareMeta: { password, includeRecords: true } }, bearer(shareOnly));
    expect(shareOnlyResponse.status).toBe(200);
    const snapshot = async (headers: HeadersInit = { cookie }) => {
      const response = await call('/tables/getViewSnapshots', { tableId: table.id, viewIds: [viewId] }, headers, 'GET');
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.snapshots).toHaveLength(1);
      return body.data.snapshots[0].data;
    };
    const before = await snapshot();
    expect(before.shareId).toBe(shareId);
    expect(before.shareMeta.password).toBe(password);
    const redacted = await snapshot(bearer(reader));
    expect(redacted).not.toHaveProperty('shareId');
    expect(redacted).not.toHaveProperty('shareMeta');
    expect(JSON.stringify(redacted)).not.toContain(password);
    expect(JSON.stringify(redacted)).not.toContain(shareId);
    const mixed = { tableId: table.id, snapshot: { id: viewId, name: 'mixed permitted update',
      type: before.type, properties: { enableShare: true, shareId,
        shareMeta: { password: 'new-private-share-password', includeRecords: true } },
      columnMeta: before.columnMeta ?? {}, query: {} } };
    for (const token of [shareOnly, updateOnly]) {
      expect((await call('/tables/applyViewSnapshot', mixed, bearer(token))).status).toBe(403);
      const unchanged = await snapshot();
      expect(unchanged.name).toBe(before.name);
      expect(unchanged.shareId).toBe(shareId);
      expect(unchanged.shareMeta).toEqual(before.shareMeta);
    }
    expect((await call('/tables/applyViewSnapshot', mixed, bearer(both))).status).toBe(200);
    const changed = await snapshot();
    expect(changed.name).toBe('mixed permitted update');
    expect(changed.shareMeta.password).toBe('new-private-share-password');
  });

  it('denies publishing a known share identifier through view creation without share scope', async () => {
    const issued = (await createAccessToken({ name: 'create view without publish', description: 'no share permission',
      scopes: ['table|read', 'view|read', 'view|create'], baseIds: [baseId], expiredTime: expiry() })).data;
    tokenIds.push(issued.id);
    const before = await call('/tables/listViews', { tableId: table.id }, { cookie }, 'GET');
    expect(before.status).toBe(200);
    const original = (await before.json()).data.views;
    const knownShareId = `shr${Date.now().toString(36).padStart(16, '0')}`;
    const denied = await call('/tables/createView', { tableId: table.id,
      view: { name: 'must not publish', type: 'grid', enableShare: true, shareId: knownShareId,
        shareMeta: { password: 'must-not-publish-password' } } }, bearer(issued.token));
    expect(denied.status).toBe(403);
    const after = await call('/tables/listViews', { tableId: table.id }, { cookie }, 'GET');
    expect(after.status).toBe(200);
    expect((await after.json()).data.views).toEqual(original);
  });

  it('rejects an actually revoked bearer token on the public mount', async () => {
    const issued = (await createAccessToken({ name: 'revoke public HTTP token', description: 'revocation',
      scopes: ['table|read'], baseIds: [baseId], expiredTime: expiry(),
    })).data;
    const before = await call('/tables/get', { baseId, tableId: table.id }, bearer(issued.token), 'GET');
    expect(before.status).toBe(200);
    await deleteAccessToken(issued.id);
    const after = await call('/tables/get', { baseId, tableId: table.id }, bearer(issued.token), 'GET');
    expect(after.status).toBe(401);
  });

  it('authorizes an installed OAuth app and enforces its granted read-only scope', async () => {
    const oauth = (await oauthCreate({
      name: 'public orpc real OAuth', scopes: ['table|read', 'record|read'],
      redirectUris: ['http://localhost:3000/callback'], homepage: 'http://localhost:3000',
    })).data;
    oauthClientId = oauth.clientId;
    const secret = (await generateOAuthSecret(oauth.clientId)).data.secret;
    const authorize = new URL(`${appUrl}/api/oauth/authorize`);
    authorize.search = new URLSearchParams({ response_type: 'code', client_id: oauth.clientId,
      scope: oauth.scopes!.join(' '), redirect_uri: oauth.redirectUris[0] }).toString();
    const consent = await fetch(authorize, { headers: { cookie }, redirect: 'manual' });
    expect(consent.status).toBe(302);
    const transaction = new URL(consent.headers.get('location')!, appUrl).searchParams.get('transaction_id');
    expect(transaction).toBeTruthy();
    const approval = await fetch(`${appUrl}/api/oauth/decision`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ transaction_id: transaction! }), redirect: 'manual',
    });
    expect(approval.status).toBe(302);
    const code = new URL(approval.headers.get('location')!, appUrl).searchParams.get('code');
    expect(code).toBeTruthy();
    const exchange = await fetch(`${appUrl}/api/oauth/access_token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: code!,
        client_id: oauth.clientId, client_secret: secret, redirect_uri: oauth.redirectUris[0] }),
    });
    expect(exchange.status).toBe(201);
    const { access_token: token } = await exchange.json();
    expect(token).toEqual(expect.any(String));
    const read = await call('/tables/get', { baseId, tableId: table.id }, bearer(token), 'GET');
    expect(read.status).toBe(200);
    const write = await call('/tables/updateRecords', {
      tableId: table.id, records: [{ id: recordId, fields: { [table.fields[0].id]: 'oauth denied' } }],
    }, bearer(token));
    expect(write.status).toBe(403);
  });
});

describe('public oRPC authenticated write parity', () => {
  let app: INestApplication;
  let appUrl: string;
  let cookie: string;
  let table: ITableFullVo;
  let token: CreateAccessTokenVo;
  beforeAll(async () => {
    ({ app, appUrl } = await initApp());
    cookie = await signInPublicHost(appUrl);
    table = await createTable(globalThis.testConfig.baseId, {
      name: 'real bearer write parity', fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [{ fields: { Name: 'persisted order anchor' } }],
    });
    token = (await createAccessToken({ name: 'public HTTP write', description: 'real write',
      scopes: ['record|create', 'record|update', 'record|read'],
      baseIds: [globalThis.testConfig.baseId],
      expiredTime: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
    })).data;
  });
  afterAll(async () => {
    try {
      if (token) await deleteAccessToken(token.id);
      if (table) await permanentDeleteTable(globalThis.testConfig.baseId, table.id);
    } finally { await app?.close(); }
  });
  it('executes writes through both genuine session and issued PAT credentials', async () => {
    for (const headers of [{ cookie }, { authorization: `Bearer ${token.token}` }]) {
      const created = await requestPublicOrpc(appUrl, '/tables/createRecord', {
        tableId: table.id, fields: { [table.fields[0].id]: 'created over HTTP' },
        order: { viewId: table.views[0].id, anchorId: table.records[0].id, position: 'before' },
      }, { headers });
      expect(created.status).toBe(201);
      const record = (await created.json()).data.record;
      expect(record.id).toMatch(/^rec/);
      const updated = await requestPublicOrpc(appUrl, '/tables/updateRecords', {
        tableId: table.id, records: [{ id: record.id, fields: { [table.fields[0].id]: 'updated over HTTP' } }],
      }, { headers });
      expect(updated.status).toBe(200);
      const read = await requestPublicOrpc(appUrl, '/tables/getRecord', {
        tableId: table.id, recordId: record.id, includeOrders: true,
      }, { method: 'GET', headers });
      expect(read.status).toBe(200);
      const persisted = (await read.json()).data.record;
      expect(persisted.fields[table.fields[0].id]).toBe('updated over HTTP');
      expect(persisted.createdBy).toBe(globalThis.testConfig.userId);
      expect(persisted.lastModifiedBy).toBe(globalThis.testConfig.userId);
      expect(persisted.createdTime).toEqual(expect.any(String));
      expect(persisted.lastModifiedTime).toEqual(expect.any(String));
      expect(persisted.version).toEqual(expect.any(Number));
      expect(persisted.autoNumber).toEqual(expect.any(Number));
      expect(persisted.orders).toHaveProperty(table.views[0].id);
      expect(persisted.orders[table.views[0].id]).toEqual(expect.any(Number));
      const anchorRead = await requestPublicOrpc(appUrl, '/tables/getRecord', {
        tableId: table.id, recordId: table.records[0].id, includeOrders: true,
      }, { method: 'GET', headers });
      expect(anchorRead.status).toBe(200);
      const anchor = (await anchorRead.json()).data.record;
      expect(persisted.orders[table.views[0].id]).toBeLessThan(anchor.orders[table.views[0].id]);
    }
  });
});
