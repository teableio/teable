/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
import { request as httpRequest, type ClientRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, SortFunc, StatisticsFunc } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import { enableShareView } from '@teable/openapi';
import {
  createV2PostgresDb,
  PostgresQueryCancelledError,
  runWithPostgresQueryCancellation,
} from '@teable/v2-adapter-db-postgres-pg';
import { PostgresUnitOfWorkTransaction } from '@teable/v2-adapter-db-postgres-shared';
import { ActorId } from '@teable/v2-core';
import axios from 'axios';
import { sql, type Kysely } from 'kysely';
import { ClsService } from 'nestjs-cls';
import { ok } from 'neverthrow';
import pg from 'pg';
import type ShareDB from 'sharedb';
import type { Connection } from 'sharedb/lib/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AggregationOpenApiV2Service } from '../src/features/aggregation/open-api/aggregation-open-api-v2.service';
import { ShareSocketService } from '../src/features/share/share-socket.service';
import { V2QueryCancellationMiddleware } from '../src/features/v2/v2-query-cancellation.middleware';
import { PerformanceCacheService } from '../src/performance-cache';
import { RecordReadonlyServiceAdapter } from '../src/share-db/readonly/record-readonly.service';
import { ShareDbService } from '../src/share-db/share-db.service';
import type { IClsStore } from '../src/types/cls';
import { createTable, initApp, permanentDeleteTable, updateRecordByApi } from './utils/init-app';

const watch = { timeout: 10000, interval: 20 };
const v2 = process.env.FORCE_V2_ALL !== 'false';
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
interface IHttpResult {
  status: number;
  body: any;
  text: string;
}
interface IRoute {
  name: string;
  path: string;
  method?: 'POST' | 'PATCH';
  query?: Record<string, unknown>;
  body?: unknown;
  check(result: any): void;
}
interface IEmitter {
  streams: unknown[];
  queryPoll(callback?: (error?: Error) => void): void;
}
type TestConnection = Connection & {
  agent: ShareDB.middleware.ConnectContext['agent'] & {
    subscribedQueries: Record<string, IEmitter | undefined>;
  };
};

/** Only the isolated fixture relation is locked; no metadata locks or customer database access. */
describe('interactive record query cancellation (real PostgreSQL / HTTP / ShareDB)', () => {
  let app: INestApplication;
  let appUrl: string;
  let cookie: string;
  let table: ITableFullVo;
  let shareId: string;
  let observer: pg.Client;
  let locker: pg.Client;
  let relation: string;
  let relationOid: number;
  let lockHeld = false;
  let dsn: string;
  let cache: PerformanceCacheService;
  let backend: ShareDbService;
  let readonly: RecordReadonlyServiceAdapter;
  let cls: ClsService<IClsStore>;
  let db: Kysely<unknown>;
  const baseId = globalThis.testConfig.baseId;
  const previousEnv = new Map<string, string | undefined>();
  const requests = new Set<ClientRequest>();
  const connections = new Set<TestConnection>();
  const drains: Array<() => void | Promise<void>> = [];
  const cacheKeys = new Set<Parameters<PerformanceCacheService['del']>[0]>();
  const clientErrors: unknown[] = [];
  const nameId = () => table.fields[0].id;
  const numberId = () => table.fields[1].id;
  const dateId = () => table.fields[2].id;
  const viewId = () => table.views[0].id;
  const recordIds = () => table.records.map((record) => record.id);
  const sortedIds = () => [table.records[1].id, table.records[2].id, table.records[0].id];
  const recordQuery = () => ({
    viewId: viewId(),
    fieldKeyType: FieldKeyType.Id,
    orderBy: [{ fieldId: nameId(), order: SortFunc.Asc }],
    projection: [nameId()],
  });

  function setEnv(key: string, value: string) {
    previousEnv.set(key, process.env[key]);
    process.env[key] = value;
  }

  function start(route: Pick<IRoute, 'path' | 'method' | 'query' | 'body'>) {
    // Axios's URI serializer is the application's array/object query convention;
    // actual transport is node HTTP, with direct ownership of the client socket.
    const url = axios.getUri({ url: `${appUrl}/api${route.path}`, params: route.query });
    let outcome: IHttpResult | Error | undefined;
    const finish = (value: IHttpResult | Error) => {
      outcome = value;
    };
    const body = route.body === undefined ? undefined : JSON.stringify(route.body);
    const req = httpRequest(
      url,
      {
        method: route.method ?? 'GET',
        headers: {
          cookie,
          connection: 'close',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', finish);
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          let parsed: unknown = text;
          try {
            parsed = JSON.parse(text);
          } catch {
            /* CSV and empty responses are not JSON. */
          }
          finish({ status: res.statusCode ?? 0, body: parsed, text });
        });
      }
    );
    if (body !== undefined) {
      req.setHeader('content-type', 'application/json');
      req.setHeader('content-length', Buffer.byteLength(body));
    }
    requests.add(req);
    req.on('error', finish);
    req.on('close', () => requests.delete(req));
    req.end(body);
    return {
      req,
      async result() {
        await vi.waitFor(
          () => expect(outcome, `HTTP ${route.path} did not settle`).toBeDefined(),
          watch
        );
        if (outcome instanceof Error) throw outcome;
        return outcome!;
      },
    };
  }

  async function successful(route: IRoute) {
    const result = await start(route).result();
    expect(result.status, `${route.name}: ${result.text}`).toBe(
      route.method === 'POST' ? 201 : 200
    );
    route.check(result.body);
    return result;
  }

  async function lock() {
    await locker.query('BEGIN');
    lockHeld = true;
    await locker.query(`LOCK TABLE ${relation} IN ACCESS EXCLUSIVE MODE`);
  }
  function lockSharedSnapshotData() {
    const service = app.get(ShareSocketService);
    const validate = service.validRecordSnapshotPermission.bind(service);
    // The existing V1 row-permission read is outside cancellation scope. Let it
    // really validate first, then block the V2 snapshot SELECT, never bypass auth.
    vi.spyOn(service, 'validRecordSnapshotPermission').mockImplementationOnce(async (...args) => {
      await validate(...args);
      await lock();
    });
  }
  async function unlock() {
    if (!lockHeld) return;
    await locker.query('ROLLBACK');
    lockHeld = false;
  }
  async function waiting() {
    const result = await observer.query<{ pid: number; query: string }>(
      `
      SELECT DISTINCT activity.pid, activity.query
      FROM pg_locks AS locks JOIN pg_stat_activity AS activity ON activity.pid = locks.pid
      WHERE locks.relation = $1::oid AND NOT locks.granted
        AND activity.datname = current_database() AND activity.state = 'active'
    `,
      [relationOid]
    );
    return result.rows;
  }
  async function waitForRead(excluded: number[] = []) {
    let found: { pid: number; query: string } | undefined;
    await vi.waitFor(async () => {
      found = (await waiting()).find(
        (row) => !excluded.includes(row.pid) && /\bselect\b/i.test(row.query)
      );
      expect(found, 'real data SELECT must be waiting on the fixture relation').toBeDefined();
    }, watch);
    return found!.pid;
  }
  async function assertStopped(pid: number) {
    await vi.waitFor(async () => {
      expect((await waiting()).some((row) => row.pid === pid)).toBe(false);
      const result = await observer.query(
        `SELECT pid FROM pg_stat_activity WHERE pid = $1 AND state = 'active'`,
        [pid]
      );
      expect(result.rows).toEqual([]);
    }, watch);
    // A successful HTTP retry alone cannot establish cancellation: the blocker is STILL held.
    const held = await observer.query(
      `SELECT 1 AS held FROM pg_locks WHERE relation = $1::oid AND mode = 'AccessExclusiveLock' AND granted`,
      [relationOid]
    );
    expect(held.rows).toEqual([{ held: 1 }]);
  }
  async function evictCapturedCache() {
    for (const key of cacheKeys) await cache.del(key);
    cacheKeys.clear();
  }
  function trackCache() {
    const wrap = cache.wrap.bind(cache);
    vi.spyOn(cache, 'wrap').mockImplementation((key, load, options) => {
      if (key.includes(table.id)) cacheKeys.add(key);
      return wrap(key, load, options);
    });
  }

  beforeAll(async () => {
    // A private app prevents this spec's enabled cache and call-through barriers from
    // leaking into another spec. FORCE_V2_ALL is deliberately never overwritten.
    setEnv('E2E_SHARED_APP', '0');
    const redisUri = process.env.BACKEND_PERFORMANCE_CACHE || process.env.BACKEND_CACHE_REDIS_URI;
    if (!redisUri)
      throw new Error(
        'This acceptance spec requires local BACKEND_CACHE_REDIS_URI or BACKEND_PERFORMANCE_CACHE'
      );
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(redisUri).hostname)) {
      throw new Error('Cancellation acceptance only permits a local Redis fixture');
    }
    setEnv('BACKEND_PERFORMANCE_CACHE', redisUri);
    dsn =
      process.env.PRISMA_META_DATABASE_URL ||
      process.env.PRISMA_DATABASE_URL ||
      process.env.DATABASE_URL ||
      '';
    if (!dsn || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(dsn).hostname)) {
      throw new Error('Cancellation acceptance only permits the local e2e PostgreSQL fixture');
    }
    const context = await initApp();
    ({ app, appUrl, cookie } = context);
    cache = app.get(PerformanceCacheService);
    backend = app.get(ShareDbService);
    readonly = app.get(RecordReadonlyServiceAdapter);
    cls = app.get(ClsService);
    table = await createTable(baseId, {
      name: 'query_cancellation_acceptance',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Amount', type: FieldType.Number },
        { name: 'Day', type: FieldType.Date },
      ],
      records: [
        { fields: { Name: 'Charlie', Amount: 30, Day: '2026-01-03T12:00:00.000Z' } },
        { fields: { Name: 'Alpha', Amount: 10, Day: '2026-01-01T12:00:00.000Z' } },
        { fields: { Name: 'Bravo', Amount: 20, Day: '2026-01-02T12:00:00.000Z' } },
      ],
    });
    shareId = (await enableShareView({ tableId: table.id, viewId: viewId() })).data.shareId;
    const meta = await app
      .get(PrismaService)
      .tableMeta.findUniqueOrThrow({ where: { id: table.id } });
    relation = meta.dbTableName.split('.').map(quote).join('.');
    observer = new pg.Client({
      connectionString: dsn,
      application_name: 'query-cancellation-observer',
    });
    locker = new pg.Client({
      connectionString: dsn,
      application_name: 'query-cancellation-locker',
    });
    await Promise.all([observer.connect(), locker.connect()]);
    const oid = await observer.query<{ oid: number }>('SELECT to_regclass($1)::oid AS oid', [
      relation,
    ]);
    relationOid = oid.rows[0].oid;
    expect(relationOid, 'fixture data and observer must use the same local database').toBeTruthy();
    db = await createV2PostgresDb({ pg: { connectionString: dsn } });
    trackCache();
    // Warm actual paths before holding any lock: canary, permission, container and
    // field metadata initialization must not be mistaken for cancellable data SQL.
    for (const route of routes()) await successful(route);
    await evictCapturedCache();
    vi.restoreAllMocks();
  }, 120000);

  beforeEach(() => trackCache());

  afterEach(async () => {
    // Always release barriers/locks before waiting for network or database drains.
    for (const req of requests) req.destroy();
    for (const connection of connections) connection.close();
    connections.clear();
    await unlock();
    for (const drain of drains.splice(0)) await drain();
    vi.restoreAllMocks();
    if (observer) await vi.waitFor(async () => expect(await waiting()).toEqual([]), watch);
    if (cache) await evictCapturedCache();
    clientErrors.length = 0;
  });
  afterAll(async () => {
    await unlock();
    await Promise.all([observer?.end(), locker?.end(), db?.destroy()]);
    if (table) await permanentDeleteTable(baseId, table.id);
    await app?.close();
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function checkRecords(body: any) {
    expect(body.records.map((record: any) => record.id)).toEqual(sortedIds());
    expect(body.records.map((record: any) => record.fields)).toEqual([
      { [nameId()]: 'Alpha' },
      { [nameId()]: 'Bravo' },
      { [nameId()]: 'Charlie' },
    ]);
  }
  function routes(): IRoute[] {
    const normal = `/table/${table.id}`;
    const shared = `/share/${shareId}`;
    const ordered = { ...recordQuery(), orderBy: JSON.stringify(recordQuery().orderBy) };
    const aggregate = { viewId: viewId(), field: { [StatisticsFunc.Sum]: [numberId()] } };
    const search = { viewId: viewId(), search: ['Alpha', nameId(), false] };
    const checkAggregation = (body: any) =>
      expect(body.aggregations).toEqual([
        expect.objectContaining({
          fieldId: numberId(),
          total: { value: 60, aggFunc: StatisticsFunc.Sum },
        }),
      ]);
    const output: IRoute[] = [
      {
        name: 'ordinary no-view aggregation',
        path: `${normal}/aggregation`,
        query: { field: { [StatisticsFunc.Sum]: [numberId()] } },
        check: checkAggregation,
      },
    ];
    for (const share of [false, true]) {
      const prefix = share ? `${shared}/view` : normal;
      const aggregation = share ? `${prefix}/aggregations` : `${normal}/aggregation`;
      const aggPrefix = share ? prefix : `${normal}/aggregation`;
      const socketPrefix = share ? `${shared}/socket/record` : `${normal}/record/socket`;
      const label = share ? 'shared' : 'ordinary';
      output.push(
        {
          name: `${label} records`,
          path: `${prefix}/${share ? 'records' : 'record'}`,
          query: ordered,
          check: checkRecords,
        },
        {
          name: `${label} aggregation`,
          path: aggregation,
          query: aggregate,
          check: checkAggregation,
        },
        {
          name: `${label} row-count`,
          path: `${aggPrefix}/row-count`,
          query: { viewId: viewId() },
          check: (body) => expect(body).toEqual({ rowCount: 3 }),
        },
        {
          name: `${label} group-points`,
          path: `${aggPrefix}/group-points`,
          query: {
            viewId: viewId(),
            groupBy: JSON.stringify([{ fieldId: nameId(), order: SortFunc.Asc }]),
          },
          check: (body) =>
            expect(
              body
                .filter((point: any) => point.type === 0 && point.depth === 0)
                .map((point: any) => point.value)
            ).toEqual(['Alpha', 'Bravo', 'Charlie']),
        },
        {
          name: `${label} search-count`,
          path: `${aggPrefix}/search-count`,
          query: search,
          check: (body) => expect(body).toEqual({ count: 1 }),
        },
        {
          name: `${label} search-index`,
          path: `${aggPrefix}/search-index`,
          query: { ...search, take: 10 },
          check: (body) =>
            expect(body).toEqual([
              expect.objectContaining({ fieldId: nameId(), recordId: table.records[1].id }),
            ]),
        },
        {
          name: `${label} calendar`,
          path: `${aggPrefix}/calendar-daily-collection`,
          query: {
            viewId: viewId(),
            startDateFieldId: dateId(),
            endDateFieldId: dateId(),
            startDate: '2026-01-01T00:00:00.000Z',
            endDate: '2026-01-04T00:00:00.000Z',
          },
          check: (body) => {
            expect(body.countMap).toEqual(
              Object.fromEntries(['2026-01-01', '2026-01-02', '2026-01-03'].map((day) => [day, 1]))
            );
            expect(body.records.map((record: any) => record.id).sort()).toEqual(
              [...recordIds()].sort(
                (a, b) => Number(String(a) > String(b)) - Number(String(a) < String(b))
              )
            );
          },
        },
        {
          name: `${label} doc-ids`,
          path: `${socketPrefix}/doc-ids`,
          method: 'POST',
          body: ordered,
          check: (body) => expect(body.ids).toEqual(sortedIds()),
        },
        {
          name: `${label} snapshot-bulk`,
          path: `${socketPrefix}/snapshot-bulk`,
          method: 'POST',
          body: {
            ids: recordIds(),
            projection: { [nameId()]: true },
          },
          check: (body) => {
            expect(body.map((snapshot: any) => snapshot.id).sort()).toEqual(
              [...recordIds()].sort(
                (a, b) => Number(String(a) > String(b)) - Number(String(a) < String(b))
              )
            );
            expect(body.map((snapshot: any) => snapshot.data.fields[nameId()]).sort()).toEqual([
              'Alpha',
              'Bravo',
              'Charlie',
            ]);
            for (const snapshot of body)
              expect(Object.keys(snapshot.data.fields)).toEqual([nameId()]);
          },
        }
      );
    }
    output.push(
      {
        name: 'ordinary single record',
        path: `${normal}/record/${table.records[0].id}`,
        query: { fieldKeyType: FieldKeyType.Id, projection: [nameId()] },
        check: (body) =>
          expect(body).toMatchObject({
            id: table.records[0].id,
            fields: { [nameId()]: 'Charlie' },
          }),
      },
      {
        name: 'ordinary selection aggregation',
        path: `${normal}/aggregation/selection`,
        query: { ...aggregate, skip: 0, take: 3 },
        check: checkAggregation,
      }
    );
    return output;
  }

  // Register names statically; fixture IDs are deliberately resolved after boot.
  for (const name of [
    ...['ordinary', 'shared'].flatMap((prefix) =>
      [
        'records',
        'aggregation',
        'row-count',
        'group-points',
        'search-count',
        'search-index',
        'calendar',
        'doc-ids',
        'snapshot-bulk',
      ].map((suffix) => `${prefix} ${suffix}`)
    ),
    'ordinary single record',
    'ordinary selection aggregation',
    'ordinary no-view aggregation',
  ]) {
    it.skipIf(!v2)(
      `physically cancels ${name} while its data relation remains locked`,
      async () => {
        const route = routes().find((route) => route.name === name)!;
        await successful(route);
        await evictCapturedCache();
        if (name === 'shared snapshot-bulk') lockSharedSnapshotData();
        else await lock();
        const pending = start(route);
        const pid = await waitForRead();
        pending.req.destroy();
        await assertStopped(pid);
        await unlock();
        await successful(route);
      },
      30000
    );
  }

  it('preserves normal GET, completed POST bodies, sorting, projection and counts in either canary mode', async () => {
    for (const route of routes()) await successful(route);
  }, 60000);

  it('preserves validation errors on a connected request', async () => {
    const result = await start({
      path: `/table/${table.id}/aggregation/selection`,
      query: { take: -1 },
    }).result();
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ message: expect.anything() });
    await successful(routes()[0]);
  });

  it('does not reclassify non-active-cancel SQLSTATE 57014 as voluntary cancellation', async () => {
    // A real server statement timeout, not a manufactured Error or aborted signal.
    // This runs with FORCE_V2_ALL=false too, through the same host middleware seam.
    const controller = new AbortController();
    const middleware = new V2QueryCancellationMiddleware(cls);
    const work = cls.run(async () => {
      cls.set('useV2', v2);
      cls.set('interactiveQueryAbort', controller.signal);
      return middleware.handle(
        { actorId: ActorId.create('system')._unsafeUnwrap() },
        {},
        async () => {
          await db.transaction().execute(async (tx) => {
            await sql`SET LOCAL statement_timeout = '40ms'`.execute(tx);
            await sql`SELECT pg_sleep(2)`.execute(tx);
          });
          return ok('unexpected');
        }
      );
    });
    const error = await work.catch((error: unknown) => error);
    expect(error).toMatchObject({ code: '57014' });
    expect(error).not.toBeInstanceOf(PostgresQueryCancelledError);
    expect(controller.signal.aborted).toBe(false);
    expect((await sql<{ value: number }>`SELECT 42 AS value`.execute(db)).rows).toEqual([
      { value: 42 },
    ]);
  });

  it.skipIf(v2)(
    'leaves disconnected V1 data SQL alone and returns correct data after the lock releases',
    async () => {
      await lock();
      const pending = start(routes()[0]);
      const pid = await waitForRead();
      pending.req.destroy();
      // Observe several turns, rather than sampling before the server receives close.
      for (let sample = 0; sample < 5; sample++) {
        await delay(30);
        expect((await waiting()).some((row) => row.pid === pid)).toBe(true);
      }
      await unlock();
      await successful(routes()[0]);
    }
  );

  async function connect(share = false, existing?: TestConnection) {
    const connection = backend.connect(existing, {
      url: `${appUrl}/socket${share ? `?shareId=${shareId}` : ''}`,
      headers: share ? {} : { cookie },
    }) as TestConnection;
    if (!existing) {
      connections.add(connection);
      connection.on('error', (error) => clientErrors.push(error));
      // The SDK surfaces receive errors even after the query was removed locally.
      connection.on('receive', ({ data }: { data: { error?: unknown } }) => {
        if (data.error) clientErrors.push(data.error);
      });
    }
    await vi.waitFor(() => expect(connection.state).toBe('connected'), watch);
    return connection;
  }
  const streams = () => (backend.pubsub as unknown as { streamsCount: number }).streamsCount;
  async function ready(connection: TestConnection) {
    const query = connection.createSubscribeQuery(`rec_${table.id}`, recordQuery(), {});
    query.on('error', (error) => clientErrors.push(error));
    await vi.waitFor(() => expect(query.ready).toBe(true), watch);
    expect(query.results.map((doc) => doc.id)).toEqual(sortedIds());
    return query;
  }

  for (const share of [false, true]) {
    for (const phase of ['doc-ids', 'snapshot-bulk'] as const) {
      it.skipIf(!v2)(
        `${share ? 'shared' : 'ordinary'} pending qs → qu stops ${phase} SQL without a late emitter`,
        async () => {
          const connection = await connect(share);
          const baseline = streams();
          if (phase === 'snapshot-bulk' && share) {
            lockSharedSnapshotData();
          } else if (phase === 'snapshot-bulk') {
            const getIds = readonly.getDocIdsByQuery.bind(readonly);
            vi.spyOn(readonly, 'getDocIdsByQuery').mockImplementationOnce(async (...args) => {
              const ids = await getIds(...args);
              expect(ids.ids).toEqual(sortedIds());
              // The real ID HTTP request has completed. Lock before the real snapshot
              // HTTP request is allowed to start; neither phase returns fake data.
              await lock();
              return ids;
            });
          } else {
            await lock();
          }
          const query = connection.createSubscribeQuery(`rec_${table.id}`, recordQuery(), {});
          query.on('error', (error) => clientErrors.push(error));
          const pid = await waitForRead();
          expect(query.ready).toBe(false);
          query.destroy();
          await assertStopped(pid);
          await vi.waitFor(() => {
            expect(connection.agent.subscribedQueries[query.id]).toBeUndefined();
            expect(streams()).toBe(baseline);
          }, watch);
          expect(clientErrors).toEqual([]);
          await unlock();
          const replacement = await ready(connection);
          replacement.destroy();
          await vi.waitFor(() => expect(streams()).toBe(baseline), watch);
        },
        30000
      );
    }
  }

  it.skipIf(!v2)(
    'cancels a ready in-flight poll without remove-all and leaves another agent updating',
    async () => {
      const baseline = streams();
      const a = await connect();
      const b = await connect();
      const first = await ready(a);
      const second = await ready(b);
      await Promise.all(
        second.results.map((doc) => {
          const { promise, resolve, reject } = deferred();
          doc.subscribe((error) => (error ? reject(error) : resolve()));
          return promise;
        })
      );
      const errors: unknown[] = [];
      second.on('error', (error) => errors.push(error));
      const removes: unknown[] = [];
      second.on('remove', (docs) => removes.push(docs));
      const emitter = a.agent.subscribedQueries[first.id]!;
      await evictCapturedCache();
      await lock();
      emitter.queryPoll();
      const pid = await waitForRead();
      first.destroy();
      await assertStopped(pid);
      await vi.waitFor(() => expect(a.agent.subscribedQueries[first.id]).toBeUndefined(), watch);
      await unlock();
      await updateRecordByApi(table.id, table.records[1].id, nameId(), 'Alpha updated');
      drains.push(() =>
        updateRecordByApi(table.id, table.records[1].id, nameId(), 'Alpha').then(() => undefined)
      );
      await vi.waitFor(
        () =>
          expect(
            second.results.find((doc) => doc.id === table.records[1].id)?.data.fields[nameId()]
          ).toBe('Alpha updated'),
        watch
      );
      expect(second.results.map((doc) => doc.id)).toEqual(sortedIds());
      expect(removes).toEqual([]);
      expect(errors).toEqual([]);
      expect(clientErrors).toEqual([]);
      second.destroy();
      b.close();
      await vi.waitFor(() => expect(streams()).toBe(baseline), watch);
    },
    30000
  );

  it.skipIf(!v2)(
    'cancels the inserted-snapshot HTTP read started by a stock ready poll',
    async () => {
      const baseline = streams();
      const connection = await connect();
      const query = connection.createSubscribeQuery(
        `rec_${table.id}`,
        {
          ...recordQuery(),
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: nameId(), operator: 'is', value: 'Alpha' }],
          },
        },
        {}
      );
      query.on('error', (error) => clientErrors.push(error));
      await vi.waitFor(() => expect(query.ready).toBe(true), watch);
      expect(query.results.map((doc) => doc.id)).toEqual([table.records[1].id]);

      const snapshots = readonly.getSnapshotBulk.bind(readonly);
      vi.spyOn(readonly, 'getSnapshotBulk').mockImplementationOnce(async (...args) => {
        await lock();
        return snapshots(...args);
      });
      drains.push(() =>
        updateRecordByApi(table.id, table.records[2].id, nameId(), 'Bravo').then(() => undefined)
      );
      await updateRecordByApi(table.id, table.records[2].id, nameId(), 'Alpha');
      const pid = await waitForRead();
      // Stock QueryEmitter supplies its own snapshotOptions here, not qs options.
      query.destroy();
      await assertStopped(pid);
      await unlock();
      await vi.waitFor(() => expect(streams()).toBe(baseline), watch);
      expect(clientErrors).toEqual([]);
    },
    30000
  );

  it.skipIf(!v2)(
    'disconnects pending SQL, drains streams and reconnects to complete results',
    async () => {
      const baseline = streams();
      const connection = await connect();
      const existing = await ready(connection);
      await lock();
      const pending = connection.createSubscribeQuery(
        `rec_${table.id}`,
        { ...recordQuery(), take: 2 },
        {}
      );
      pending.on('error', (error) => clientErrors.push(error));
      const pid = await waitForRead();
      const oldAgent = connection.agent;
      connection.close();
      await assertStopped(pid);
      pending.destroy();
      await vi.waitFor(() => {
        expect(Object.keys(oldAgent.subscribedQueries)).toEqual([]);
        expect(streams()).toBe(baseline);
      }, watch);
      await unlock();
      await connect(false, connection);
      await vi.waitFor(() => {
        expect(connection.agent.subscribedQueries[existing.id]).toBeDefined();
        expect(existing.results.map((doc) => doc.id)).toEqual(sortedIds());
      }, watch);
      existing.destroy();
      expect(clientErrors).toEqual([]);
    },
    30000
  );

  it('drains a real initial ShareDB HTTP validation failure and permits a healthy subscription retry', async () => {
    const baseline = streams();
    const connection = await connect();
    let initialError: unknown;
    const rejected = connection.createSubscribeQuery(
      `rec_${table.id}`,
      { ...recordQuery(), take: -1 },
      {},
      (error) => {
        initialError = error;
      }
    );
    await vi.waitFor(() => {
      expect(initialError).toBeTruthy();
      expect(connection.agent.subscribedQueries[rejected.id]).toBeUndefined();
      expect(streams()).toBe(baseline);
    }, watch);
    rejected.destroy();
    const retry = await ready(connection);
    expect(retry.results.map((doc) => doc.data.fields[nameId()])).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
    retry.destroy();
    await vi.waitFor(() => expect(streams()).toBe(baseline), watch);
  }, 30000);

  it.skipIf(!v2)(
    'cancelled cache-miss A never caches an empty count; same-key B fills a real cache entry',
    async () => {
      const route = routes().find((route) => route.name === 'ordinary row-count')!;
      await successful(route);
      await evictCapturedCache();
      await lock();
      const a = start(route);
      const pid = await waitForRead();
      const b = start(route);
      a.req.destroy();
      await assertStopped(pid);
      // B must make its own data SELECT after A releases Redlock, not consume zero.
      await waitForRead([pid]);
      await unlock();
      const result = await b.result();
      expect(result.status, result.text).toBe(200);
      expect(result.body).toEqual({ rowCount: 3 });
      // With the table locked again, C can only complete by using the genuine cache.
      await lock();
      await successful(route);
      expect(await waiting()).toEqual([]);
    },
    30000
  );

  it.skipIf(!v2)(
    'interactive cancellation leaves a concurrent write and CSV export running to real completion',
    async () => {
      await lock();
      const abandoned = start(routes()[0]);
      const pid = await waitForRead();
      const write = start({
        path: `/table/${table.id}/record/${table.records[0].id}`,
        method: 'PATCH',
        body: {
          fieldKeyType: FieldKeyType.Id,
          record: { fields: { [numberId()]: 31 } },
        },
      });
      const exported = start({ path: `/export/${table.id}`, query: { viewId: viewId() } });
      await vi.waitFor(
        async () => expect((await waiting()).length).toBeGreaterThanOrEqual(3),
        watch
      );
      abandoned.req.destroy();
      await assertStopped(pid);
      expect((await waiting()).length).toBeGreaterThanOrEqual(2);
      await unlock();
      const written = await write.result();
      expect(written.status, written.text).toBe(200);
      expect(written.body.fields[numberId()]).toBe(31);
      drains.push(() =>
        updateRecordByApi(table.id, table.records[0].id, numberId(), 30).then(() => undefined)
      );
      const csv = await exported.result();
      expect(csv.status, csv.text).toBe(200);
      for (const value of ['Name', 'Amount', 'Charlie', 'Alpha', 'Bravo'])
        expect(csv.text).toContain(value);
    },
    30000
  );

  it.skipIf(!v2)(
    'response-scheduled background SQL survives its originating interactive request abort',
    async () => {
      const service = app.get(AggregationOpenApiV2Service);
      const original = service.getRowCount.bind(service);
      const middleware = new V2QueryCancellationMiddleware(cls);
      const finished = deferred();
      let backgroundRows: unknown;
      let backgroundError: unknown;
      const marker = `background_${table.id}`;
      vi.spyOn(service, 'getRowCount').mockImplementationOnce(async (...args) => {
        const signal = cls.get('interactiveQueryAbort')!;
        // Schedule from an actual HTTP CLS and adapter scope, so either inherited
        // signal (CLS or ALS) would stop this real statement if isolation regresses.
        await runWithPostgresQueryCancellation(signal, async () => {
          cls.get('scheduleV2BackgroundTask')!(async () => {
            try {
              const result = await middleware.handle(
                { actorId: ActorId.create('system')._unsafeUnwrap() },
                {},
                async () =>
                  ok(
                    (
                      await sql
                        .raw(`SELECT __id FROM ${relation} /* ${marker} */ ORDER BY __id`)
                        .execute(db)
                    ).rows
                  )
              );
              backgroundRows = result._unsafeUnwrap();
            } catch (error) {
              backgroundError = error;
            } finally {
              finished.resolve();
            }
          });
          drains.push(() => finished.promise);
        });
        return original(...args);
      });
      const route = routes().find((route) => route.name === 'ordinary row-count')!;
      await lock();
      const request = start(route);
      const pid = await waitForRead();
      request.req.destroy();
      await assertStopped(pid);
      await vi.waitFor(
        async () => expect((await waiting()).some((row) => row.query.includes(marker))).toBe(true),
        watch
      );
      await unlock();
      await vi.waitFor(() => expect(backgroundRows ?? backgroundError).toBeDefined(), watch);
      expect(backgroundError).toBeUndefined();
      expect(
        (backgroundRows as Array<{ __id: string }>)
          .map((row) => row.__id)
          .toSorted((a: string, b: string) => Number(a > b) - Number(a < b))
      ).toEqual([...recordIds()].toSorted((a: string, b: string) => Number(a > b) - Number(a < b)));
      await finished.promise;
    },
    30000
  );

  it.skipIf(!v2)(
    'existing write transaction completes SQL and commits despite an aborted outer interactive scope',
    async () => {
      const controller = new AbortController();
      const middleware = new V2QueryCancellationMiddleware(cls);
      const marker = `transaction_${table.id}`;
      await lock();
      const transaction = db.transaction().execute(async (tx) =>
        cls.run(async () => {
          cls.set('useV2', true);
          cls.set('interactiveQueryAbort', controller.signal);
          const context = {
            actorId: ActorId.create('system')._unsafeUnwrap(),
            transaction: new PostgresUnitOfWorkTransaction(tx, 'data'),
          };
          return runWithPostgresQueryCancellation(controller.signal, () =>
            middleware.handle(context, {}, async () => {
              const result = await sql
                .raw(`SELECT __id FROM ${relation} /* ${marker} */ ORDER BY __id`)
                .execute(tx);
              return ok(result.rows);
            })
          );
        })
      );
      // Attach rejection handler immediately so a failing implementation cannot leak an unhandled rejection.
      const outcome = transaction.then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      );
      drains.push(() => outcome.then(() => undefined));
      const pid = await waitForRead();
      controller.abort();
      for (let sample = 0; sample < 5; sample++) {
        await delay(30);
        expect((await waiting()).some((row) => row.pid === pid)).toBe(true);
      }
      await unlock();
      const result = await outcome;
      expect(result).not.toHaveProperty('error');
      if ('value' in result)
        expect(
          result.value
            ._unsafeUnwrap()
            .map((row: { __id: string }) => row.__id)
            .toSorted((a: string, b: string) => Number(a > b) - Number(a < b))
        ).toEqual(
          [...recordIds()].toSorted((a: string, b: string) => Number(a > b) - Number(a < b))
        );
    },
    30000
  );
});
