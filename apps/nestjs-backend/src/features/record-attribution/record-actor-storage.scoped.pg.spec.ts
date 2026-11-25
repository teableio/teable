import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createScopedDataPrismaClient,
  DataPrismaService,
  type ScopedDataPrismaClient,
} from '@teable/db-data-prisma';
import { defaultPgPoolFactory, PgPoolRegistry, PrismaService } from '@teable/db-main-prisma';
import { V2PgTableSchemaCoordination } from '@teable/v2-adapter-db-postgres-pg';
import { createV2NodePgContainer, disposeV2NodePgContainer } from '@teable/v2-container-node';
import {
  ActorId,
  v2CoreTokens,
  type ISchemaOperationRepository,
  type SchemaOperationRunnerService,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { knex, type Knex } from 'knex';
import { ClsService } from 'nestjs-cls';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataDbClientManager } from '../../global/data-db-client-manager.service';
import {
  DATA_DB_PRISMA_CACHE_NAMESPACE,
  DataDbRuntimeCacheService,
} from '../../global/data-db-runtime-cache.service';
import { DatabaseRouter } from '../../global/database-router.service';
import type { IClsStore } from '../../types/cls';
import { encryptDataDbUrl } from '../space/data-db-url-secret';
import {
  actorColumnsRuntimeRouteKey,
  registerActorColumnsEnableHandler,
} from '../v2/v2-actor-columns-registration';
import { RecordActorStorageService } from './record-actor-storage.service';

const metaUrl = process.env.RECORD_ACTOR_PG_URL;
const dataUrl = process.env.RECORD_ACTOR_DATA_PG_URL;

// Actual scoped factory, separate owned databases, and existing official data models.
// This proves transaction ownership/atomic effects, not a full record CRUD endpoint.
describe.skipIf(!metaUrl || !dataUrl)('Actor lease with independent scoped data Prisma', () => {
  let cls: ClsService<IClsStore>;
  let registry: PgPoolRegistry;
  let meta: PrismaService;
  let observer: Pool;
  let data: ScopedDataPrismaClient;
  let otherRoute: ScopedDataPrismaClient;
  let visibility: ScopedDataPrismaClient;
  let fallback: DataPrismaService;
  let compiler: Knex;
  let cache: DataDbRuntimeCacheService;
  let manager: DataDbClientManager;
  let router: DatabaseRouter;
  let connectionId: string;
  let storage: RecordActorStorageService;
  let coordination: V2PgTableSchemaCoordination;
  let spaceId: string;
  let baseId: string;
  let tableId: string;
  const rows: string[] = [];
  const events: string[] = [];
  const request = <T>(work: () => T) => cls.runWith({ tx: {}, dataTx: {} } as IClsStore, work);
  const additionalConnections: string[] = [];

  beforeAll(async () => {
    if (!metaUrl || !dataUrl) throw new Error('Both owned PostgreSQL URLs are required');
    const metadata = new URL(metaUrl);
    const independent = new URL(dataUrl);
    if (metadata.host === independent.host && metadata.pathname === independent.pathname) {
      throw new Error(
        'Independent scoped data proof requires a different database, not another schema'
      );
    }
    cls = new ClsService<IClsStore>(new AsyncLocalStorage());
    registry = new PgPoolRegistry(defaultPgPoolFactory);
    const metadataLease = registry.acquire(metaUrl);
    observer = metadataLease.pool;
    meta = new PrismaService(
      cls as never,
      metadataLease,
      metadata.searchParams.get('schema') ?? 'public'
    );
    data = createScopedDataPrismaClient(
      registry.acquire(dataUrl),
      independent.searchParams.get('schema') ?? 'public'
    );
    otherRoute = createScopedDataPrismaClient(
      registry.acquire(metaUrl),
      metadata.searchParams.get('schema') ?? 'public'
    );
    // Independent factory + pool: an uncommitted write must stay invisible to it,
    // unlike the owning factory root, which now joins its own active transaction.
    visibility = createScopedDataPrismaClient(
      registry.acquire(dataUrl, { poolName: 'app-platform-actor-visibility-observer' }),
      independent.searchParams.get('schema') ?? 'public'
    );
    const previousMetaUrl = process.env.PRISMA_META_DATABASE_URL;
    try {
      process.env.PRISMA_META_DATABASE_URL = metaUrl;
      fallback = new DataPrismaService(
        cls as never,
        registry.acquire(metaUrl),
        metadata.searchParams.get('schema') ?? 'public'
      );
    } finally {
      if (previousMetaUrl === undefined) delete process.env.PRISMA_META_DATABASE_URL;
      else process.env.PRISMA_META_DATABASE_URL = previousMetaUrl;
    }
    await meta.$connect();
    await data.$connect();
    await visibility.$connect();
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    spaceId = `spc${suffix}`;
    baseId = `bse${suffix}`;
    tableId = `tbl${suffix}`;
    await meta.space.create({
      data: { id: spaceId, name: 'app platform independent scoped proof', createdBy: 'system' },
    });
    await meta.base.create({
      data: { id: baseId, spaceId, name: 'Scoped proof', order: 1, createdBy: 'system' },
    });
    await meta.tableMeta.create({
      data: {
        id: tableId,
        baseId,
        name: 'Scoped proof',
        dbTableName: `${baseId}.${tableId}`,
        version: 1,
        order: 1,
        createdBy: 'system',
        actorStorageVersion: 0,
      },
    });
    const connection = await meta.dataDbConnection.create({
      data: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
        urlFingerprint: createHash('sha256').update(dataUrl).digest('hex'),
        internalSchema: independent.searchParams.get('schema') ?? 'public',
        status: 'ready',
        createdBy: 'system',
      },
    });
    connectionId = connection.id;
    await meta.spaceDataDbBinding.create({
      data: {
        spaceId,
        dataDbConnectionId: connectionId,
        mode: 'byodb',
        state: 'ready',
        createdBy: 'system',
      },
    });
    compiler = knex({ client: 'pg' });
    cache = new DataDbRuntimeCacheService();
    manager = new DataDbClientManager(meta, fallback, compiler, cache, registry, undefined, cls);
    router = new DatabaseRouter(meta, fallback, compiler, compiler, manager, cls);
    storage = new RecordActorStorageService(
      meta,
      cls,
      new ConfigService({ PRISMA_META_DATABASE_URL: metaUrl })
    );
    coordination = new V2PgTableSchemaCoordination({ connectionString: metaUrl });
  });
  afterAll(async () => {
    await storage?.onModuleDestroy();
    await coordination?.destroy();
    await cache?.onModuleDestroy();
    if (data) {
      await data.recordTrash.deleteMany({ where: { id: { in: rows } } });
      await data.domainEventOutbox.deleteMany({ where: { id: { in: events } } });
      await data.$disconnect();
    }
    await visibility?.$disconnect();
    await otherRoute?.$disconnect();
    await fallback?.onModuleDestroy();
    await compiler?.destroy();
    if (meta) {
      if (tableId) await meta.tableMeta.deleteMany({ where: { id: tableId } });
      if (baseId) await meta.base.deleteMany({ where: { id: baseId } });
      if (spaceId) await meta.spaceDataDbBinding.deleteMany({ where: { spaceId } });
      if (connectionId) await meta.dataDbConnection.deleteMany({ where: { id: connectionId } });
      if (additionalConnections.length)
        await meta.dataDbConnection.deleteMany({ where: { id: { in: additionalConnections } } });
      if (spaceId) await meta.space.deleteMany({ where: { id: spaceId } });
      await meta.onModuleDestroy();
    }
    await registry?.onApplicationShutdown();
  });

  it.each(['commit', 'rollback'] as const)(
    'keeps row and journal on the callback executor through %s',
    async (outcome) => {
      const rowId = randomUUID();
      const eventId = randomUUID();
      rows.push(rowId);
      events.push(eventId);
      let metadataPublished = false;
      let afterCommitCalls = 0;
      const failure = new Error('Injected after real row and journal writes');
      const transaction = request(() =>
        storage.withTableWrite(tableId, async () => {
          const result = await data.$tx(async (tx) => {
            const [connection] = await tx.$queryRawUnsafe<Array<{ database: string }>>(
              'SELECT current_database() AS database'
            );
            expect(connection.database).toBe(
              decodeURIComponent(new URL(dataUrl!).pathname.slice(1))
            );
            await tx.recordTrash.create({
              data: {
                id: rowId,
                tableId,
                recordId: `rec${rowId}`,
                snapshot: '{}',
                createdBy: 'system',
              },
            });
            await tx.domainEventOutbox.create({
              data: {
                id: eventId,
                baseId,
                tableId,
                messageName: 'record.deleted',
                schemaVersion: 1,
                payload: { recordId: `rec${rowId}` },
                payloadBytes: 0,
                catalogGeneration: 1,
                requiredConsumers: [],
              },
            });
            expect(
              data.afterCommit(async () => {
                afterCommitCalls += 1;
                expect(await data.recordTrash.count({ where: { id: rowId } })).toBe(1);
                expect(await data.domainEventOutbox.count({ where: { id: eventId } })).toBe(1);
              })
            ).toBe(true);
            // Separate factory/pool: uncommitted effects must stay invisible. The
            // owning factory root would join this transaction and see them.
            const [external] = await visibility.$queryRawUnsafe<Array<{ database: string }>>(
              'SELECT current_database() AS database'
            );
            expect(external.database).toBe(decodeURIComponent(new URL(dataUrl!).pathname.slice(1)));
            expect(await visibility.recordTrash.count({ where: { id: rowId } })).toBe(0);
            expect(await visibility.domainEventOutbox.count({ where: { id: eventId } })).toBe(0);
            if (outcome === 'rollback') throw failure;
            return rowId;
          });
          metadataPublished = true;
          return result;
        })
      );
      if (outcome === 'rollback') await expect(transaction).rejects.toBe(failure);
      else await expect(transaction).resolves.toBe(rowId);
      expect(await data.recordTrash.count({ where: { id: rowId } })).toBe(
        outcome === 'commit' ? 1 : 0
      );
      expect(await data.domainEventOutbox.count({ where: { id: eventId } })).toBe(
        outcome === 'commit' ? 1 : 0
      );
      expect(metadataPublished).toBe(outcome === 'commit');
      expect(afterCommitCalls).toBe(outcome === 'commit' ? 1 : 0);
      const lease = (
        await coordination.acquire(
          { actorId: ActorId.create('system')._unsafeUnwrap() },
          [tableId],
          'exclusive'
        )
      )._unsafeUnwrap();
      await lease.release();
    }
  );

  it('joins nested transactions and root raw SQL only within the owning factory instance', async () => {
    const rowId = randomUUID();
    rows.push(rowId);
    const failure = new Error('Expected root raw SQL rollback');
    const probe =
      'SELECT current_database() AS database, pg_backend_pid() AS pid, pg_current_xact_id()::text AS xid';
    type Probe = { database: string; pid: number; xid: string };
    await expect(
      data.$tx(async (tx) => {
        expect(data.txClient()).toBe(tx);
        const [owner] = await tx.$queryRawUnsafe<Probe[]>(probe);
        const [root] = await data.$queryRawUnsafe<Probe[]>(probe);
        expect(root).toEqual(owner);
        await data.$tx(async (nested) => {
          expect(nested).toBe(tx);
          expect((await nested.$queryRawUnsafe<Probe[]>(probe))[0]).toEqual(owner);
        });
        expect(otherRoute.txClient()).toBe(otherRoute);
        await otherRoute.$tx(async (other) => {
          expect(otherRoute.txClient()).toBe(other);
          expect(data.txClient()).toBe(tx);
          const [unrelated] = await other.$queryRawUnsafe<Probe[]>(probe);
          expect(unrelated.database).not.toBe(owner.database);
          expect(unrelated.pid).not.toBe(owner.pid);
        });
        await data.$executeRawUnsafe(
          `INSERT INTO record_trash
        (id, table_id, record_id, snapshot, created_by) VALUES ($1, $2, $3, '{}', 'system')`,
          rowId,
          tableId,
          `rec${rowId}`
        );
        expect(await tx.recordTrash.count({ where: { id: rowId } })).toBe(1);
        throw failure;
      })
    ).rejects.toBe(failure);
    expect(await data.recordTrash.count({ where: { id: rowId } })).toBe(0);
    expect(data.txClient()).toBe(data);
    expect(
      data.afterCommit(async () => {
        throw new Error('Must not register outside a real transaction');
      })
    ).toBe(false);
  });

  it.each(['commit', 'rollback'] as const)(
    'executes the real DatabaseRouter callback and afterCommit lifecycle on %s',
    async (outcome) => {
      const rowId = randomUUID();
      const eventId = randomUUID();
      rows.push(rowId);
      events.push(eventId);
      let hooks = 0;
      const failure = new Error('Expected routed effect rollback');
      const transaction = request(() =>
        storage.withTableWrite(tableId, () =>
          router.dataPrismaTransactionForTable(tableId, async (tx) => {
            const routed = (await router.dataPrismaForTable(tableId)) as ScopedDataPrismaClient;
            expect(cls.get('dataDb')?.mode).toBe('byodb');
            expect(routed.txClient()).toBe(tx);
            await tx.$executeRawUnsafe(
              `INSERT INTO record_trash
          (id, table_id, record_id, snapshot, created_by) VALUES ($1, $2, $3, '{}', 'system')`,
              rowId,
              tableId,
              `rec${rowId}`
            );
            await tx.$executeRawUnsafe(
              `INSERT INTO domain_event_outbox
          (id, base_id, table_id, message_name, schema_version, payload, payload_bytes, catalog_generation, required_consumers)
          VALUES ($1, $2, $3, 'record.deleted', 1, '{}'::jsonb, 2, 1, '[]'::jsonb)`,
              eventId,
              baseId,
              tableId
            );
            expect(
              routed.afterCommit(async () => {
                hooks += 1;
                expect(await data.recordTrash.count({ where: { id: rowId } })).toBe(1);
                expect(await data.domainEventOutbox.count({ where: { id: eventId } })).toBe(1);
              })
            ).toBe(true);
            if (outcome === 'rollback') throw failure;
            return rowId;
          })
        )
      );
      if (outcome === 'rollback') await expect(transaction).rejects.toBe(failure);
      else await expect(transaction).resolves.toBe(rowId);
      expect(hooks).toBe(outcome === 'commit' ? 1 : 0);
      expect(await data.recordTrash.count({ where: { id: rowId } })).toBe(
        outcome === 'commit' ? 1 : 0
      );
      expect(await data.domainEventOutbox.count({ where: { id: eventId } })).toBe(
        outcome === 'commit' ? 1 : 0
      );
    }
  );

  it('the real Router rejects before scoped COMMIT when the metadata lease backend is lost', async () => {
    const rowId = randomUUID();
    const eventId = randomUUID();
    rows.push(rowId);
    events.push(eventId);
    let allowReturn!: () => void;
    // ES2022 project: Promise.withResolvers is unavailable in the declared libraries.
    const finish = new Promise<void>((resolve) => {
      allowReturn = resolve;
    });
    let mutationReady = false;
    let checkHeld: (() => void | Promise<void>) | undefined;
    const transaction = request(() =>
      storage.withTableWrite(tableId, () =>
        router.dataPrismaTransactionForTable(
          tableId,
          async (tx) => {
            await tx.$executeRawUnsafe(
              `INSERT INTO record_trash
          (id, table_id, record_id, snapshot, created_by) VALUES ($1, $2, $3, '{}', 'system')`,
              rowId,
              tableId,
              `rec${rowId}`
            );
            await tx.$executeRawUnsafe(
              `INSERT INTO domain_event_outbox
          (id, base_id, table_id, message_name, schema_version, payload, payload_bytes, catalog_generation, required_consumers)
          VALUES ($1, $2, $3, 'record.deleted', 1, '{}'::jsonb, 2, 1, '[]'::jsonb)`,
              eventId,
              baseId,
              tableId
            );
            const scope = cls.get('actorStorageScope');
            if (!scope)
              throw new Error('Expected the actual helper to own a shared metadata lease');
            checkHeld = () => scope.assertHeld();
            mutationReady = true;
            await finish;
            // No test-side guard here: DatabaseRouter must check before actual COMMIT.
          },
          { timeout: 15_000 }
        )
      )
    );
    const outcome = transaction.then(
      () => undefined,
      (error: unknown) => error
    );
    try {
      await vi.waitFor(() => expect(mutationReady).toBe(true), { timeout: 2_000, interval: 20 });
      const held = await observer.query<{ pid: number }>(
        `
        SELECT a.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE l.locktype = 'advisory' AND l.granted AND l.mode = 'ShareLock' AND l.objsubid = 1
          AND a.application_name = 'teable-record-actor-storage'
          AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND l.classid::bigint = ((hashtextextended($1, 0) >> 32) & 4294967295)
          AND l.objid::bigint = (hashtextextended($1, 0) & 4294967295)
      `,
        [`teable.schema:table:${tableId}`]
      );
      expect(held.rows).toHaveLength(1);
      await observer.query('SELECT pg_terminate_backend($1)', [held.rows[0].pid]);
      await vi.waitFor(
        async () => {
          const check = checkHeld;
          if (!check) throw new Error('Expected a local scope check');
          await expect(Promise.resolve().then(() => check())).rejects.toBeInstanceOf(
            ServiceUnavailableException
          );
        },
        { timeout: 2_000, interval: 20 }
      );
      allowReturn();
      expect(await outcome).toBeInstanceOf(ServiceUnavailableException);
      expect(await data.recordTrash.count({ where: { id: rowId } })).toBe(0);
      expect(await data.domainEventOutbox.count({ where: { id: eventId } })).toBe(0);
      const lease = (
        await coordination.acquire(
          { actorId: ActorId.create('system')._unsafeUnwrap() },
          [tableId],
          'exclusive'
        )
      )._unsafeUnwrap();
      await lease.release();
    } finally {
      allowReturn();
      await outcome;
    }
  });

  it('reloads A→B→A bindings within one request and never reuses retired scoped clients', async () => {
    const second = await meta.dataDbConnection.create({
      data: {
        encryptedUrl: encryptDataDbUrl(metaUrl!),
        urlFingerprint: createHash('sha256').update(metaUrl!).digest('hex'),
        internalSchema: new URL(metaUrl!).searchParams.get('schema') ?? 'public',
        status: 'ready',
        createdBy: 'system',
      },
    });
    additionalConnections.push(second.id);
    const epoch = Date.now();
    const initial = await meta.spaceDataDbBinding.findUniqueOrThrow({ where: { spaceId } });
    try {
      await request(async () => {
        const oldA = (await router.dataPrismaForTable(tableId)) as ScopedDataPrismaClient;
        expect(
          (
            await oldA.$queryRawUnsafe<Array<{ database: string }>>(
              'SELECT current_database() AS database'
            )
          )[0].database
        ).toBe(decodeURIComponent(new URL(dataUrl!).pathname.slice(1)));
        const cutoverB = (
          await coordination.acquire(
            { actorId: ActorId.create('system')._unsafeUnwrap() },
            [tableId],
            'exclusive'
          )
        )._unsafeUnwrap();
        try {
          await meta.spaceDataDbBinding.update({
            where: { spaceId },
            data: {
              dataDbConnectionId: second.id,
              lastModifiedTime: new Date(epoch + 1000),
            },
          });
          await cache.delete(DATA_DB_PRISMA_CACHE_NAMESPACE, connectionId);
        } finally {
          await cutoverB.release();
        }
        await expect(
          Promise.resolve().then(() =>
            oldA.$tx((tx) => tx.$queryRawUnsafe('SELECT current_database()'))
          )
        ).rejects.toThrow('Scoped data database client has been retired');
        const routeB = await storage.withTableWrite(tableId, async () => {
          const binding = await manager.getDataDatabaseForBase(baseId);
          expect(binding.connectionId).toBe(second.id);
          const current = (await router.dataPrismaForTable(tableId)) as ScopedDataPrismaClient;
          expect(
            (
              await current.$queryRawUnsafe<Array<{ database: string }>>(
                'SELECT current_database() AS database'
              )
            )[0].database
          ).toBe(decodeURIComponent(new URL(metaUrl!).pathname.slice(1)));
          return current;
        });
        expect(routeB).not.toBe(oldA);
        const cutoverA = (
          await coordination.acquire(
            { actorId: ActorId.create('system')._unsafeUnwrap() },
            [tableId],
            'exclusive'
          )
        )._unsafeUnwrap();
        try {
          await meta.spaceDataDbBinding.update({
            where: { spaceId },
            data: {
              dataDbConnectionId: connectionId,
              lastModifiedTime: new Date(epoch + 2000),
            },
          });
          await cache.delete(DATA_DB_PRISMA_CACHE_NAMESPACE, second.id);
        } finally {
          await cutoverA.release();
        }
        await expect(
          Promise.resolve().then(() =>
            routeB.$tx((tx) => tx.$queryRawUnsafe('SELECT current_database()'))
          )
        ).rejects.toThrow('Scoped data database client has been retired');
        await storage.withTableWrite(tableId, async () => {
          const binding = await manager.getDataDatabaseForBase(baseId);
          expect(binding.connectionId).toBe(connectionId);
          const returnedA = (await router.dataPrismaForTable(tableId)) as ScopedDataPrismaClient;
          expect(returnedA).not.toBe(oldA);
          expect(returnedA).not.toBe(routeB);
          expect(
            (
              await returnedA.$queryRawUnsafe<Array<{ database: string }>>(
                'SELECT current_database() AS database'
              )
            )[0].database
          ).toBe(decodeURIComponent(new URL(dataUrl!).pathname.slice(1)));
        });
      });
      const returned = await meta.spaceDataDbBinding.findUniqueOrThrow({ where: { spaceId } });
      expect(returned.dataDbConnectionId).toBe(initial.dataDbConnectionId);
      expect(returned.lastModifiedTime?.getTime()).not.toBe(initial.lastModifiedTime?.getTime());
    } finally {
      await meta.spaceDataDbBinding.update({
        where: { spaceId },
        data: { dataDbConnectionId: connectionId, lastModifiedTime: new Date(epoch + 3000) },
      });
      await cache.delete(DATA_DB_PRISMA_CACHE_NAMESPACE, second.id);
    }
  });

  it('retires a queued old-A enable across A→B→A and publishes only the fresh server target', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    const legacyId = `tbl${suffix}`;
    const fieldId = `fld${suffix}`;
    const recordId = `rec${suffix}`;
    const physical = `"${baseId}"."${legacyId}"`;
    const actor = { actorId: ActorId.create('system')._unsafeUnwrap() };
    const activeContainers = new Set<DependencyContainer>();
    let releaseCutover: (() => Promise<void>) | undefined;
    let retiredWork: Promise<unknown> | undefined;
    let retirement: Promise<void> | undefined;
    const original = await meta.spaceDataDbBinding.findUniqueOrThrow({ where: { spaceId } });
    const epoch = Math.max(Date.now(), original.lastModifiedTime?.getTime() ?? 0);
    const alternativeUrl = new URL(metaUrl!);
    alternativeUrl.searchParams.set('application_name', `app-platform-route-${suffix}`);
    const alternative = await meta.dataDbConnection.create({
      data: {
        encryptedUrl: encryptDataDbUrl(alternativeUrl.toString()),
        urlFingerprint: createHash('sha256').update(alternativeUrl.toString()).digest('hex'),
        internalSchema: new URL(metaUrl!).searchParams.get('schema') ?? 'public',
        status: 'ready',
        createdBy: 'system',
      },
    });
    additionalConnections.push(alternative.id);
    const createCurrentContainer = async () => {
      const route = await request(() => manager.getDataDatabaseForBase(baseId));
      const connectionString = route.connectionUrl ?? route.url;
      const core = await createV2NodePgContainer({
        metaConnectionString: metaUrl!,
        dataConnectionString: connectionString,
        dataSchema: route.internalSchema,
        ensureSchema: false,
      });
      activeContainers.add(core);
      registerActorColumnsEnableHandler(core, connectionString, route.internalSchema);
      return {
        core,
        routeKey: actorColumnsRuntimeRouteKey(connectionString, route.internalSchema),
      };
    };
    try {
      // Baseline pre-actor native business shape: capability defaults to 0.
      // No new version-1 table is downgraded and no official system schema is fabricated.
      await meta.tableMeta.create({
        data: {
          id: legacyId,
          baseId,
          name: 'Native legacy route proof',
          dbTableName: `${baseId}.${legacyId}`,
          version: 1,
          order: 2,
          createdBy: 'system',
        },
      });
      await meta.field.create({
        data: {
          id: fieldId,
          tableId: legacyId,
          name: 'Title',
          type: 'singleLineText',
          cellValueType: 'string',
          dbFieldType: 'TEXT',
          dbFieldName: 'Title',
          isPrimary: true,
          version: 1,
          order: 1,
          createdBy: 'system',
        },
      });
      await data.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${baseId}"`);
      await data.$executeRawUnsafe(`CREATE TABLE ${physical} (
        __id text NOT NULL UNIQUE, __auto_number serial, __created_time timestamptz NOT NULL DEFAULT now(),
        __created_by text NOT NULL, __last_modified_time timestamptz, __last_modified_by text,
        __version integer NOT NULL, "Title" text)`);
      await data.$executeRawUnsafe(
        `INSERT INTO ${physical} (__id, __created_by, __version, "Title")
        VALUES ($1, 'system', 1, 'existing legacy row')`,
        recordId
      );
      // B already contains a native pre-actor destination. Never strip actor
      // columns from an enabled table to manufacture this transition.
      await otherRoute.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${baseId}"`);
      await otherRoute.$executeRawUnsafe(`CREATE TABLE ${physical} (
        __id text NOT NULL UNIQUE, __auto_number serial, __created_time timestamptz NOT NULL DEFAULT now(),
        __created_by text NOT NULL, __last_modified_time timestamptz, __last_modified_by text,
        __version integer NOT NULL, "Title" text)`);
      await otherRoute.$executeRawUnsafe(
        `INSERT INTO ${physical} (__id, __created_by, __version, "Title")
        VALUES ($1, 'system', 1, 'preexisting destination B')`,
        recordId
      );
      expect(
        (await meta.tableMeta.findUniqueOrThrow({ where: { id: legacyId } })).actorStorageVersion
      ).toBe(0);
      const first = await createCurrentContainer();
      const operations = first.core.resolve<ISchemaOperationRepository>(
        v2CoreTokens.schemaOperationRepository
      );
      const oldTarget = (
        await operations.getActorColumnsTarget!(actor, baseId, legacyId, first.routeKey)
      )._unsafeUnwrap();
      const enqueued = (await operations.enqueueActorColumns!(actor, oldTarget))._unsafeUnwrap();
      const oldRunner = first.core.resolve<SchemaOperationRunnerService>(
        v2CoreTokens.schemaOperationRunnerService
      );
      const oldClaim = (
        await oldRunner.claimNext(actor, { workerId: `old-route:${legacyId}` })
      )._unsafeUnwrap();
      if (oldClaim.status !== 'claimed') throw new Error('Expected the actual enable claim');
      expect(oldClaim.operation.id).toBe(enqueued.id);
      const cutover = (await coordination.acquire(actor, [legacyId], 'exclusive'))._unsafeUnwrap();
      releaseCutover = () => cutover.release();
      retiredWork = oldRunner.runOperation(actor, oldClaim.operation).then((result) => {
        expect(result.isErr() || result.value.status !== 'completed').toBe(true);
      });
      await vi.waitFor(
        async () => {
          const waiting = await observer.query<{ count: string }>(
            `
          SELECT count(*)::text AS count FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE l.locktype = 'advisory' AND NOT l.granted AND l.objsubid = 1
            AND a.application_name = 'teable-v2-schema-coordination'
            AND l.classid::bigint = ((hashtextextended($1, 0) >> 32) & 4294967295)
            AND l.objid::bigint = (hashtextextended($1, 0) & 4294967295)
        `,
            [`teable.schema:table:${legacyId}`]
          );
          expect(Number(waiting.rows[0].count)).toBe(1);
        },
        { timeout: 1_000, interval: 20 }
      );
      await meta.schemaOperation.update({
        where: { id: enqueued.id },
        data: {
          status: 'error',
          phase: 'error',
          lockedBy: null,
          lockedAt: null,
          nextRunAt: new Date(),
          lastError: 'Record attribution target database binding changed',
        },
      });
      await meta.spaceDataDbBinding.update({
        where: { spaceId },
        data: {
          dataDbConnectionId: alternative.id,
          lastModifiedTime: new Date(epoch + 1000),
        },
      });
      await cache.delete(DATA_DB_PRISMA_CACHE_NAMESPACE, connectionId);
      let retired = false;
      retirement = disposeV2NodePgContainer(first.core).then(() => {
        retired = true;
        activeContainers.delete(first.core);
      });
      await vi.waitFor(() => expect(retired).toBe(true), { timeout: 1_000, interval: 20 });
      await retirement;
      await retiredWork;
      // External exclusive lease is deliberately still held: the retired waiter
      // cannot acquire it later and publish an old capability.
      expect(
        (await meta.tableMeta.findUniqueOrThrow({ where: { id: legacyId } })).actorStorageVersion
      ).toBe(0);
      const [beforeRetry] = await data.$queryRawUnsafe<Array<{ count: bigint }>>(
        `
        SELECT count(*) AS count FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 AND column_name IN
          ('__created_by_actor_type', '__created_by_actor_id', '__last_modified_by_actor_type', '__last_modified_by_actor_id')
      `,
        baseId,
        legacyId
      );
      expect(Number(beforeRetry.count)).toBe(0);
      const onB = (await request(() =>
        router.dataPrismaForTable(legacyId)
      )) as ScopedDataPrismaClient;
      expect(
        (
          await onB.$queryRawUnsafe<Array<{ database: string }>>(
            'SELECT current_database() AS database'
          )
        )[0].database
      ).toBe(decodeURIComponent(new URL(metaUrl!).pathname.slice(1)));
      await meta.spaceDataDbBinding.update({
        where: { spaceId },
        data: {
          dataDbConnectionId: connectionId,
          lastModifiedTime: new Date(epoch + 2000),
        },
      });
      await cache.delete(DATA_DB_PRISMA_CACHE_NAMESPACE, alternative.id);
      await cutover.release();
      releaseCutover = undefined;
      const returned = await createCurrentContainer();
      const currentOps = returned.core.resolve<ISchemaOperationRepository>(
        v2CoreTokens.schemaOperationRepository
      );
      const runner = returned.core.resolve<SchemaOperationRunnerService>(
        v2CoreTokens.schemaOperationRunnerService
      );
      // Payload remains old A, but actual route is A again: the binding epoch must
      // still reject this stale operation even though the runtime route key matches.
      const stale = (
        await runner.claimNext(actor, { workerId: `stale-A:${legacyId}` })
      )._unsafeUnwrap();
      if (stale.status !== 'claimed')
        throw new Error('Expected the old pending operation to be reclaimable');
      expect(stale.operation.id).toBe(enqueued.id);
      expect((await runner.runOperation(actor, stale.operation))._unsafeUnwrap().status).toBe(
        'failed'
      );
      expect(
        (await meta.tableMeta.findUniqueOrThrow({ where: { id: legacyId } })).actorStorageVersion
      ).toBe(0);
      const fresh = (
        await currentOps.getActorColumnsTarget!(actor, baseId, legacyId, returned.routeKey)
      )._unsafeUnwrap();
      expect(fresh.runtimeRouteKey).toBe(oldTarget.runtimeRouteKey);
      expect(fresh.storageEpoch).not.toBe(oldTarget.storageEpoch);
      expect((await currentOps.enqueueActorColumns!(actor, fresh))._unsafeUnwrap().id).toBe(
        enqueued.id
      );
      const freshClaim = (
        await runner.claimNext(actor, { workerId: `fresh-A:${legacyId}` })
      )._unsafeUnwrap();
      if (freshClaim.status !== 'claimed')
        throw new Error('Expected fresh enable to be immediately claimable');
      expect((await runner.runOperation(actor, freshClaim.operation))._unsafeUnwrap().status).toBe(
        'completed'
      );
      expect(
        (await meta.tableMeta.findUniqueOrThrow({ where: { id: legacyId } })).actorStorageVersion
      ).toBe(1);
      const [row] = await data.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM ${physical} WHERE __id = $1`,
        recordId
      );
      expect(row.Title).toBe('existing legacy row');
      expect(row.__created_by_actor_type).toBeNull();
      expect(row.__created_by_actor_id).toBeNull();
      // A stale API snapshot may not rearm an operation after capability 1 committed.
      expect((await currentOps.enqueueActorColumns!(actor, fresh)).isErr()).toBe(true);
      expect(
        (await meta.schemaOperation.findUniqueOrThrow({ where: { id: enqueued.id } })).status
      ).toBe('ready');
      const restoreFence = (
        await coordination.acquire(actor, [legacyId], 'exclusive')
      )._unsafeUnwrap();
      try {
        // Model the supported restore/revalidation metadata boundary under its
        // exclusive lease; routing's existing invalidator rejects missing actor
        // columns rather than resetting capability, so it cannot implement this fixture.
        await request(() =>
          meta.$tx(async (tx) => {
            await tx.spaceDataDbBinding.update({
              where: { spaceId },
              data: {
                dataDbConnectionId: alternative.id,
                lastModifiedTime: new Date(epoch + 4000),
              },
            });
            await tx.tableMeta.update({
              where: { id: legacyId },
              data: {
                actorStorageVersion: 0,
                version: { increment: 1 },
              },
            });
          })
        );
        await cache.delete(DATA_DB_PRISMA_CACHE_NAMESPACE, connectionId);
      } finally {
        await restoreFence.release();
      }
      const destination = await createCurrentContainer();
      const destinationOps = destination.core.resolve<ISchemaOperationRepository>(
        v2CoreTokens.schemaOperationRepository
      );
      const destinationRunner = destination.core.resolve<SchemaOperationRunnerService>(
        v2CoreTokens.schemaOperationRunnerService
      );
      const targetB = (
        await destinationOps.getActorColumnsTarget!(actor, baseId, legacyId, destination.routeKey)
      )._unsafeUnwrap();
      expect(targetB.connectionId).toBe(alternative.id);
      const rearmed = (await destinationOps.enqueueActorColumns!(actor, targetB))._unsafeUnwrap();
      expect(rearmed).toMatchObject({
        id: enqueued.id,
        status: 'pending',
        attempts: 0,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        payload: targetB,
      });
      expect(rearmed.result).toBeUndefined();
      // The old completed worker cannot settle or publish this new target.
      const oldReplay = await runner.runOperation(actor, freshClaim.operation);
      expect(oldReplay.isErr() || oldReplay.value.status !== 'completed').toBe(true);
      expect(
        (await meta.schemaOperation.findUniqueOrThrow({ where: { id: enqueued.id } })).status
      ).toBe('pending');
      const claimedB = (
        await destinationRunner.claimNext(actor, { workerId: `fresh-B:${legacyId}` })
      )._unsafeUnwrap();
      if (claimedB.status !== 'claimed')
        throw new Error('Expected rearmed ready operation to be claimable');
      expect(
        (await destinationRunner.runOperation(actor, claimedB.operation))._unsafeUnwrap().status
      ).toBe('completed');
      expect(
        (await meta.tableMeta.findUniqueOrThrow({ where: { id: legacyId } })).actorStorageVersion
      ).toBe(1);
      const [rowB] = await otherRoute.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM ${physical} WHERE __id = $1`,
        recordId
      );
      expect(rowB.Title).toBe('preexisting destination B');
      expect(rowB.__created_by_actor_type).toBeNull();
      expect(rowB.__created_by_actor_id).toBeNull();
    } finally {
      await releaseCutover?.();
      await retiredWork?.catch(() => undefined);
      await retirement?.catch(() => undefined);
      for (const core of activeContainers) await disposeV2NodePgContainer(core);
      await meta.spaceDataDbBinding.update({
        where: { spaceId },
        data: { dataDbConnectionId: connectionId, lastModifiedTime: new Date(epoch + 3000) },
      });
      await cache.delete(DATA_DB_PRISMA_CACHE_NAMESPACE, alternative.id);
      await meta.schemaOperation.deleteMany({ where: { tableId: legacyId } });
      await meta.field.deleteMany({ where: { tableId: legacyId } });
      await meta.tableMeta.deleteMany({ where: { id: legacyId } });
      await data.$executeRawUnsafe(`DROP TABLE IF EXISTS ${physical}`);
      await data.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${baseId}"`);
      await otherRoute.$executeRawUnsafe(`DROP TABLE IF EXISTS ${physical}`);
      await otherRoute.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${baseId}"`);
    }
  }, 30_000);
});
