import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { DataPrismaService, createScopedDataPrismaClient } from '@teable/db-data-prisma';
import type { ScopedDataPrismaClient } from '@teable/db-data-prisma';
import { defaultPgPoolFactory, PgPoolRegistry, PrismaService } from '@teable/db-main-prisma';
import Knex from 'knex';
import type { Knex as KnexType } from 'knex';
import { ClsService } from 'nestjs-cls';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DuplicateTableQueryPostgres } from '../../db-provider/duplicate-table/duplicate-query.postgres';
import type { IClsStore } from '../../types/cls';
import { RecordActorStorageService } from '../record-attribution/record-actor-storage.service';
import { RecordMutationPolicyService } from '../record-mutation-policy/record-mutation-policy.service';
import { TableDuplicateService } from './table-duplicate.service';

// Explicit owner-provisioned official schemas only; never infer a developer/customer URL.
const ownedUrl = process.env.RECORD_ACTOR_PG_URL;
const scopedUrl = process.env.RECORD_ACTOR_BYODB_PG_URL ?? ownedUrl;

describe.skipIf(!ownedUrl)('Direct table-copy PostgreSQL rollback', () => {
  let cls: ClsService<IClsStore>;
  let registry: PgPoolRegistry;
  let prisma: PrismaService;
  let defaultData: DataPrismaService;
  let scopedData: ScopedDataPrismaClient | undefined;
  let storage: RecordActorStorageService;
  let dataKnex: KnexType;
  let spaceId: string;
  let baseId: string;
  let sourceId: string;
  let targetId: string;
  let route: DataPrismaService | ScopedDataPrismaClient | undefined;

  beforeEach(async () => {
    if (!ownedUrl) throw new Error('RECORD_ACTOR_PG_URL must name an owned official schema');
    cls = new ClsService<IClsStore>(new AsyncLocalStorage());
    registry = new PgPoolRegistry(defaultPgPoolFactory);
    const schema = new URL(ownedUrl).searchParams.get('schema') ?? 'public';
    prisma = new PrismaService(cls as never, registry.acquire(ownedUrl, { max: 8 }), schema);
    defaultData = new DataPrismaService(
      cls as never,
      registry.acquire(ownedUrl, { max: 8 }),
      schema
    );
    await prisma.$connect();
    await defaultData.$connect();
    storage = new RecordActorStorageService(
      prisma,
      cls,
      new ConfigService({ PRISMA_META_DATABASE_URL: ownedUrl })
    );
    dataKnex = Knex({ client: 'pg' });
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    spaceId = `spc${suffix}`;
    baseId = `bse${suffix}`;
    sourceId = `tbl${suffix.slice(0, 15)}a`;
    targetId = `tbl${suffix.slice(0, 15)}b`;
    await prisma.space.create({
      data: { id: spaceId, name: 'Copy rollback proof', createdBy: 'system' },
    });
    await prisma.base.create({
      data: { id: baseId, spaceId, name: 'Copy rollback proof', order: 1, createdBy: 'system' },
    });
    await prisma.tableMeta.createMany({
      data: [sourceId, targetId].map((id, order) => ({
        id,
        baseId,
        name: id,
        dbTableName: `${baseId}.${id}`,
        order,
        version: 1,
        actorStorageVersion: 0,
        provisionState: 'ready',
        createdBy: 'system',
      })),
    });
  });

  afterEach(async () => {
    await storage?.onModuleDestroy();
    if (route && baseId) await route.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${baseId}" CASCADE`);
    if (prisma && baseId) {
      await prisma.tableMeta.deleteMany({ where: { baseId } });
      await prisma.base.deleteMany({ where: { id: baseId } });
      await prisma.space.deleteMany({ where: { id: spaceId } });
    }
    await scopedData?.$disconnect();
    scopedData = undefined;
    route = undefined;
    await defaultData?.onModuleDestroy();
    await prisma?.onModuleDestroy();
    await registry?.onApplicationShutdown();
    await dataKnex?.destroy();
  });

  it.each(['default', 'scoped'] as const)(
    'rolls back copied rows on journal failure through the actual %s client',
    async (mode) => {
      if (mode === 'scoped') {
        if (!scopedUrl) throw new Error('An owned scoped data URL is required');
        scopedData = createScopedDataPrismaClient(
          registry.acquire(scopedUrl, { max: 8 }),
          new URL(scopedUrl).searchParams.get('schema') ?? 'public'
        );
        await scopedData.$connect();
      }
      const data = mode === 'scoped' ? scopedData! : defaultData;
      route = data;
      // Only disposable physical record tables are created here. Metadata comes from
      // the owner's real Prisma schema, not a hand-built approximation of system tables.
      await data.$executeRawUnsafe(`CREATE SCHEMA "${baseId}"`);
      for (const id of [sourceId, targetId]) {
        await data.$executeRawUnsafe(`CREATE TABLE "${baseId}"."${id}" (
        "__id" text PRIMARY KEY, "__auto_number" serial UNIQUE,
        "__created_time" timestamptz NOT NULL DEFAULT now(), "__created_by" text NOT NULL,
        "__last_modified_time" timestamptz, "__last_modified_by" text,
        "__version" integer NOT NULL, "Title" text,
        "__created_by_actor_type" text, "__created_by_actor_id" text,
        "__last_modified_by_actor_type" text, "__last_modified_by_actor_id" text
      )`);
      }
      await data.$executeRawUnsafe(`INSERT INTO "${baseId}"."${sourceId}"
      ("__id", "__version", "__created_by", "Title") VALUES ('recSource', 1, 'system', 'original')`);
      const failure = new Error('Injected operation journal failure');
      const dataPrismaForTable = vi.fn(async (tableId: string) => {
        expect(tableId).toBe(targetId);
        return data;
      });
      const persistRecordCreateOperationAudit = vi.fn(
        async (
          tableId: string,
          count: number,
          ids: ReadonlyArray<string>,
          execute: (query: string) => Promise<unknown>
        ) => {
          expect(tableId).toBe(targetId);
          expect(count).toBe(1);
          expect(ids).toEqual(['recSource']);
          // The supplied journal executor must be the same callback transaction, not
          // the root client's per-query scoped transaction. This write must roll back too.
          await execute(`UPDATE "${baseId}"."${sourceId}" SET "Title" = 'must roll back'`);
          throw failure;
        }
      );
      const service = Object.create(TableDuplicateService.prototype) as TableDuplicateService;
      Object.assign(service, { recordMutationPolicy: new RecordMutationPolicyService() });
      Object.assign(service, {
        cls,
        prismaService: prisma,
        recordActorStorageService: storage,
        dataKnex,
        tableService: {
          createTable: async () => ({ id: targetId, dbTableName: `${baseId}.${targetId}` }),
        },
        dataDbClientManager: { dataPrismaForTable },
        eventEmitterService: { persistRecordCreateOperationAudit },
        audit: {
          withOperation: async (_operation: unknown, action: () => Promise<unknown>) => action(),
        },
        dbProvider: {
          columnInfo: (name: string) => {
            const [schema, table] = name.split('.');
            return dataKnex('information_schema.columns')
              .select({ name: 'column_name' })
              .where({ table_schema: schema, table_name: table })
              .toQuery();
          },
          duplicateTableQuery: (query: KnexType.QueryBuilder) =>
            new DuplicateTableQueryPostgres(query),
        },
        disableTableDomainDataLoader: vi.fn(),
        duplicateFields: async () => ({}),
        duplicateViews: async () => ({}),
        repairDuplicateOmit: vi.fn(),
        assertSameDataDatabaseForRecordCopy: vi.fn(),
        duplicateAttachments: vi.fn(),
        duplicateLinkJunction: vi.fn(),
      });
      await expect(
        cls.runWith(
          {
            tx: {},
            dataTx: {},
            user: { id: 'system' },
            recordInitiator: { type: 'appUser', id: 'apuCurrent' },
          } as IClsStore,
          () => service.duplicateTable(baseId, sourceId, { name: 'Copy', includeRecords: true })
        )
      ).rejects.toBe(failure);
      expect(dataPrismaForTable).toHaveBeenCalledOnce();
      expect(persistRecordCreateOperationAudit).toHaveBeenCalledOnce();
      const copied = await data.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) AS count FROM "${baseId}"."${targetId}"`
      );
      expect(Number(copied[0].count)).toBe(0);
      const source = await data.$queryRawUnsafe<Record<'Title', string>[]>(
        `SELECT "Title" FROM "${baseId}"."${sourceId}"`
      );
      expect(source[0].Title).toBe('original');
      expect(
        (await prisma.tableMeta.findUniqueOrThrow({ where: { id: targetId } })).provisionState
      ).toBe('error');
    }
  );

  it.each([false, true])(
    'rolls the real INSERT and journal callback back together (%s)',
    async (failJournal) => {
      const data = defaultData;
      await data.$executeRawUnsafe(`CREATE SCHEMA "${baseId}"`);
      for (const id of [sourceId, targetId]) {
        await data.$executeRawUnsafe(`CREATE TABLE "${baseId}"."${id}" (
        "__id" text PRIMARY KEY, "__auto_number" serial UNIQUE,
        "__created_time" timestamptz NOT NULL DEFAULT now(), "__created_by" text NOT NULL,
        "__last_modified_time" timestamptz, "__last_modified_by" text,
        "__version" integer NOT NULL, "Title" text,
        "__created_by_actor_type" text, "__created_by_actor_id" text,
        "__last_modified_by_actor_type" text, "__last_modified_by_actor_id" text
      )`);
      }
      await data.$executeRawUnsafe(`INSERT INTO "${baseId}"."${sourceId}"
      ("__id", "__version", "__created_by", "Title") VALUES ('recSource', 1, 'system', 'original')`);
      const failure = new Error('Injected operation journal failure');
      const service = Object.create(TableDuplicateService.prototype) as TableDuplicateService;
      Object.assign(service, { recordMutationPolicy: new RecordMutationPolicyService() });
      Object.assign(service, {
        cls,
        prismaService: prisma,
        recordActorStorageService: storage,
        dataKnex,
        tableService: {
          createTable: async () => ({ id: targetId, dbTableName: `${baseId}.${targetId}` }),
        },
        dataDbClientManager: { dataPrismaForTable: async () => data },
        eventEmitterService: {
          persistRecordCreateOperationAudit: async (
            _tableId: string,
            count: number,
            ids: ReadonlyArray<string>,
            execute: (sql: string) => Promise<unknown>
          ) => {
            expect(count).toBe(1);
            expect(ids).toEqual(['recSource']);
            await execute(`UPDATE "${baseId}"."${sourceId}" SET "Title" = 'must roll back'`);
            if (failJournal) throw failure;
          },
        },
        audit: {
          withOperation: async (_operation: unknown, action: () => Promise<unknown>) => action(),
        },
        dbProvider: {
          columnInfo: (name: string) => {
            const [schema, table] = name.split('.');
            return dataKnex('information_schema.columns')
              .select({ name: 'column_name' })
              .where({ table_schema: schema, table_name: table })
              .toQuery();
          },
          duplicateTableQuery: (query: KnexType.QueryBuilder) =>
            new DuplicateTableQueryPostgres(query),
        },
        disableTableDomainDataLoader: vi.fn(),
        duplicateFields: async () => ({}),
        duplicateViews: async () => ({}),
        repairDuplicateOmit: vi.fn(),
        assertSameDataDatabaseForRecordCopy: vi.fn(),
        duplicateAttachments: vi.fn(),
        duplicateLinkJunction: vi.fn(),
      });
      const run = () =>
        cls.runWith(
          {
            tx: {},
            dataTx: {},
            user: { id: 'system' },
            recordInitiator: { type: 'appUser', id: 'apuCurrent' },
          } as IClsStore,
          () => service.duplicateTable(baseId, sourceId, { name: 'Copy', includeRecords: true })
        );
      if (failJournal) {
        await expect(run()).rejects.toBe(failure);
      } else {
        await run();
      }
      const target = await data.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) AS count FROM "${baseId}"."${targetId}"`
      );
      expect(Number(target[0].count)).toBe(failJournal ? 0 : 1);
      const source = await data.$queryRawUnsafe<Record<'Title', string>[]>(
        `SELECT "Title" FROM "${baseId}"."${sourceId}"`
      );
      expect(source[0].Title).toBe(failJournal ? 'original' : 'must roll back');
    }
  );
});
