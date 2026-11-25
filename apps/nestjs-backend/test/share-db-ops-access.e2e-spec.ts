import { setTimeout as sleep } from 'node:timers/promises';
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, IdPrefix } from '@teable/core';
import { enableShareView, updateRecord } from '@teable/openapi';
import type { ITableFullVo } from '@teable/openapi';
import type { Connection } from 'sharedb/lib/client';
import type { ConnectionReceiveRequest } from 'sharedb/lib/sharedb';
import { ShareDbService } from '../src/share-db/share-db.service';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { createTable, initApp, permanentDeleteTable } from './utils/init-app';

type IWireMessage = {
  a?: string;
  c?: string;
  d?: string;
  error?: { code?: string | number; message?: string };
};

const asCookieHeader = (value: unknown) =>
  Array.isArray(value) ? value.join('; ') : String(value ?? '');

const connected = async (connection: Connection) => {
  const deadline = Date.now() + 5000;
  while (connection.state !== 'connected' && Date.now() < deadline) {
    await sleep(20);
  }
  if (connection.state !== 'connected') throw new Error('socket did not connect');
};

/** Sends one wire message and resolves with the server's reply to it. */
const ask = async (connection: Connection, message: IWireMessage & Record<string, unknown>) => {
  await connected(connection);
  const { promise, resolve, reject } = Promise.withResolvers<IWireMessage>();
  const onReceive = (request: ConnectionReceiveRequest) => {
    const data: IWireMessage | undefined = request.data;
    if (data?.a !== message.a || data.c !== message.c) return;
    if (message.d !== undefined && data.d !== message.d) return;
    connection.removeListener('receive', onReceive);
    // Answered here: the client library has no document waiting for this reply.
    request.data = null;
    resolve(data);
  };
  connection.on('receive', onReceive);
  connection.send(message as never);
  const timer = setTimeout(() => reject(new Error(`no reply to ${message.a}`)), 8000);
  return promise.finally(() => clearTimeout(timer));
};

const liveOpsFor = (connection: Connection, collection: string, docId: string) => {
  const ops: unknown[] = [];
  connection.on('receive', (request: ConnectionReceiveRequest) => {
    const data: (IWireMessage & { op?: unknown }) | undefined = request.data;
    if (data?.a === 'op' && data.c === collection && data.d === docId) {
      ops.push(data.op);
      request.data = null;
    }
  });
  return ops;
};

// A subscribe that names a version skips the authorized snapshot read: the adapter only
// compares versions, and ShareDB then streams the document's live ops. These cases hold a
// version far ahead of the document, the shape that needs no snapshot at all.
describe('ShareDB ops catch-up access (e2e)', () => {
  let app: INestApplication;
  let shareDbService: ShareDbService;
  let ownerCookie: string;
  let outsiderCookie: string;
  let table: ITableFullVo;
  let otherTable: ITableFullVo;
  let shareId: string;
  let previousForceV2All: string | undefined;
  const baseId = globalThis.testConfig.baseId;
  const connections: Connection[] = [];
  const aheadVersion = 100000;

  const connect = (options: { cookie?: string; shareId?: string } = {}) => {
    const query = options.shareId ? `?shareId=${options.shareId}` : '';
    const connection = shareDbService.connect(undefined, {
      url: `ws://localhost:${process.env.PORT}/socket${query}`,
      headers: options.cookie ? { cookie: options.cookie } : {},
    });
    connection.on('error', () => undefined);
    connections.push(connection);
    return connection;
  };

  const subscribeAt = (connection: Connection, collection: string, docId: string) =>
    ask(connection, { a: 's', c: collection, d: docId, v: aheadVersion });

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';
    const context = await initApp();
    app = context.app;
    ownerCookie = context.cookie;
    shareDbService = app.get(ShareDbService);
    const outsider = await createNewUserAxios({
      email: `ops-access-outsider-${Date.now()}@example.com`,
      password: '12345678',
    });
    outsiderCookie = asCookieHeader(outsider.defaults.headers.Cookie);

    const fields = [{ name: 'Name', type: FieldType.SingleLineText }];
    table = await createTable(baseId, {
      name: 'ops access',
      fields,
      records: [{ fields: { Name: 'row' } }],
    });
    otherTable = await createTable(baseId, {
      name: 'ops access other',
      fields,
      records: [{ fields: { Name: 'row' } }],
    });
    shareId = (await enableShareView({ tableId: table.id, viewId: table.defaultViewId! })).data
      .shareId;
  });

  afterAll(async () => {
    for (const connection of connections) connection.close();
    await permanentDeleteTable(baseId, table.id);
    await permanentDeleteTable(baseId, otherTable.id);
    await app.close();
    if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
    else process.env.FORCE_V2_ALL = previousForceV2All;
  });

  const recordCollection = () => `${IdPrefix.Record}_${table.id}`;
  const recordId = () => table.records[0].id;

  it('serves a collaborator, who then hears the live ops', async () => {
    const connection = connect({ cookie: ownerCookie });
    const ops = liveOpsFor(connection, recordCollection(), recordId());

    const reply = await subscribeAt(connection, recordCollection(), recordId());
    expect(reply.error).toBeUndefined();

    await updateRecord(table.id, recordId(), {
      fieldKeyType: FieldKeyType.Name,
      record: { fields: { Name: 'heard by the collaborator' } },
    });
    const deadline = Date.now() + 5000;
    while (!ops.length && Date.now() < deadline) await sleep(20);
    expect(ops.length).toBeGreaterThan(0);
  });

  it.each([
    ['a signed-in user who is not a collaborator', () => ({ cookie: outsiderCookie })],
    ['a cookie that is no session', () => ({ cookie: 'not-a-session=1' })],
    ['a connection with no credential', () => ({})],
  ])('refuses %s, who hears nothing afterwards', async (_label, credentials) => {
    const connection = connect(credentials());
    const ops = liveOpsFor(connection, recordCollection(), recordId());

    const reply = await subscribeAt(connection, recordCollection(), recordId());
    expect(reply.error).toBeDefined();

    await updateRecord(table.id, recordId(), {
      fieldKeyType: FieldKeyType.Name,
      record: { fields: { Name: `not heard ${Date.now()}` } },
    });
    await sleep(800);
    expect(ops).toEqual([]);
  });

  it('refuses the same on the bulk path, for fields, views and tables', async () => {
    const connection = connect({ cookie: outsiderCookie });

    const bulk = await ask(connection, {
      a: 'bs',
      c: recordCollection(),
      b: { [recordId()]: aheadVersion },
    });
    expect(bulk.error).toBeDefined();

    for (const [collection, docId] of [
      [`${IdPrefix.Field}_${table.id}`, table.fields[0].id],
      [`${IdPrefix.View}_${table.id}`, table.defaultViewId!],
      [`${IdPrefix.Table}_${baseId}`, table.id],
    ]) {
      const reply = await subscribeAt(connection, collection, docId);
      expect(reply.error, collection).toBeDefined();
    }
  });

  it('keeps a view share to the table it shares', async () => {
    const connection = connect({ shareId });

    const own = await subscribeAt(connection, recordCollection(), recordId());
    expect(own.error).toBeUndefined();

    const other = await subscribeAt(
      connection,
      `${IdPrefix.Record}_${otherTable.id}`,
      otherTable.records[0].id
    );
    expect(other.error).toBeDefined();
  });

  it('does not serve snapshots at a version, to anyone', async () => {
    const connection = connect({ cookie: ownerCookie });

    const reply = await ask(connection, {
      a: 'nf',
      c: `${IdPrefix.Table}_${baseId}`,
      d: table.id,
      v: 1,
    });
    expect(reply.error).toBeDefined();
  });
});
