import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { FieldKeyType } from '@teable/core';
import { createScopedDataPrismaClient, DataPrismaService } from '@teable/db-data-prisma';
import { defaultPgPoolFactory, PgPoolRegistry, PrismaService } from '@teable/db-main-prisma';
import type { ICreateTableRo, ITableVo } from '@teable/openapi';
import { knex, type Knex } from 'knex';
import { ClsService } from 'nestjs-cls';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PostgresProvider } from '../../db-provider/postgres.provider';
import { DataDbClientManager } from '../../global/data-db-client-manager.service';
import { DataDbRuntimeCacheService } from '../../global/data-db-runtime-cache.service';
import type { RawOpStagingService } from '../../share-db/raw-op-staging.service';
import type { IClsStore } from '../../types/cls';
import { TableSnapshotReadService } from './table-snapshot-read.service';
import { TableService } from './table.service';

const databaseUrl = process.env.RECORD_ACTOR_PG_URL;
const actorColumns = [
  '__created_by_actor_type',
  '__created_by_actor_id',
  '__last_modified_by_actor_type',
  '__last_modified_by_actor_id',
];

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

// Runs only against the explicitly owned, already-migrated acceptance database.
// Metadata, physical CREATE, default-route resolution and commit hooks are real.
// Only socket operation delivery is replaced; it is not this storage-ordering proof.
describe.skipIf(!databaseUrl)(
  'TableService default-route actor publication (real PostgreSQL)',
  () => {
    let cls: ClsService<IClsStore>;
    let registry: PgPoolRegistry;
    let meta: PrismaService;
    let data: DataPrismaService;
    let observer: Pool;
    let compiler: Knex;
    let cache: DataDbRuntimeCacheService;
    let service: TableService;
    let baseId: string;
    let spaceId: string;
    const saveRawOps = vi.fn();
    const previousMetaUrl = process.env.PRISMA_META_DATABASE_URL;
    const request = <T>(work: () => T) =>
      cls.runWith(
        {
          tx: {},
          dataTx: {},
          user: { id: 'system' },
        } as IClsStore,
        work
      );
    const input = (name: string): ICreateTableRo => ({ name, fieldKeyType: FieldKeyType.Id });

    beforeAll(async () => {
      if (!databaseUrl) throw new Error('An explicitly owned PostgreSQL URL is required');
      process.env.PRISMA_META_DATABASE_URL = databaseUrl;
      cls = new ClsService<IClsStore>(new AsyncLocalStorage());
      registry = new PgPoolRegistry(defaultPgPoolFactory);
      const lease = registry.acquire(databaseUrl);
      observer = lease.pool;
      const schema = new URL(databaseUrl).searchParams.get('schema') ?? 'public';
      meta = new PrismaService(cls as never, lease, schema);
      data = new DataPrismaService(cls as never, registry.acquire(databaseUrl), schema);
      await meta.$connect();
      await data.$connect();
      const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
      baseId = `bse${suffix}`;
      spaceId = `spc${suffix}`;
      await meta.space.create({
        data: { id: spaceId, name: 'Actor creation ordering', createdBy: 'system' },
      });
      await meta.base.create({
        data: {
          id: baseId,
          spaceId,
          name: 'Actor creation ordering',
          order: 1,
          createdBy: 'system',
        },
      });
      await observer.query(`CREATE SCHEMA "${baseId}"`);
      compiler = knex({ client: 'pg' });
      cache = new DataDbRuntimeCacheService();
      const manager = new DataDbClientManager(
        meta,
        data,
        compiler,
        cache,
        registry,
        undefined,
        cls
      );
      expect(await request(() => manager.dataPrismaForBase(baseId, { useTransaction: true }))).toBe(
        data
      );
      service = new TableService(
        cls,
        meta,
        manager,
        { saveRawOps } as unknown as RawOpStagingService,
        new TableSnapshotReadService(meta, {
          getBaseShareVisibleResourceIds: vi.fn().mockResolvedValue(undefined),
        } as never),
        new PostgresProvider(compiler),
        compiler
      );
    });

    afterAll(async () => {
      if (observer && baseId) await observer.query(`DROP SCHEMA IF EXISTS "${baseId}" CASCADE`);
      if (meta && baseId) await meta.tableMeta.deleteMany({ where: { baseId } });
      if (meta && baseId) await meta.base.deleteMany({ where: { id: baseId } });
      if (meta && spaceId) await meta.space.deleteMany({ where: { id: spaceId } });
      await cache?.onModuleDestroy();
      await compiler?.destroy();
      await data?.onModuleDestroy();
      await meta?.onModuleDestroy();
      await registry?.onApplicationShutdown();
      if (previousMetaUrl === undefined) delete process.env.PRISMA_META_DATABASE_URL;
      else process.env.PRISMA_META_DATABASE_URL = previousMetaUrl;
    });

    const metadata = async (tableId: string) => {
      const result = await observer.query<
        Record<'actor_storage_version', number> & Record<'provision_state', string>
      >('SELECT actor_storage_version, provision_state FROM table_meta WHERE id = $1', [tableId]);
      return result.rows[0];
    };

    it('does not publish inherited capability 1 until the actual outer data transaction commits', async () => {
      let created: ITableVo | undefined;
      await request(() =>
        data.$tx(async (transaction) => {
          const inheritedInput = { ...input('outer_commit'), actorStorageVersion: 1 };
          created = await service.createTable(baseId, inheritedInput);
          expect(created.actorStorageVersion).toBe(0);
          expect(await metadata(created.id)).toEqual({
            actor_storage_version: 0,
            provision_state: 'pending',
          });
          const columns = await transaction.$queryRawUnsafe<Array<Record<'column_name', string>>>(
            'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = ANY($3::text[])',
            baseId,
            'outer_commit',
            actorColumns
          );
          expect(columns.map((column) => column.column_name).sort()).toEqual(
            [...actorColumns].sort()
          );
          const beforeCommit = await observer.query<{ relation: string | null }>(
            'SELECT to_regclass($1)::text AS relation',
            [`${baseId}.outer_commit`]
          );
          expect(beforeCommit.rows[0]?.relation).toBeNull();
          expect((await metadata(created.id)).actor_storage_version).toBe(0);
        })
      );

      expect(created).toBeDefined();
      expect(created!.actorStorageVersion).toBe(1);
      expect(await metadata(created!.id)).toEqual({
        actor_storage_version: 1,
        provision_state: 'ready',
      });
      const committed = await observer.query<{ relation: string | null }>(
        'SELECT to_regclass($1)::text AS relation',
        [`${baseId}.outer_commit`]
      );
      expect(committed.rows[0]?.relation).not.toBeNull();
      for (const prefix of ['__created_by_actor', '__last_modified_by_actor']) {
        for (const [type, id] of [
          ['user', null],
          [null, 'usr_orphan'],
          ['invalid', 'actor'],
          ['appUser', ''],
        ] as const) {
          await expect(
            observer.query(
              `INSERT INTO "${baseId}"."outer_commit" ("__id", "__created_by", "__version", "${prefix}_type", "${prefix}_id") VALUES ($1, 'system', 1, $2, $3)`,
              [`rec${randomUUID().replaceAll('-', '').slice(0, 16)}`, type, id]
            )
          ).rejects.toMatchObject({ code: '23514' });
        }
      }
      expect(
        (
          await observer.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM "${baseId}"."outer_commit"`
          )
        ).rows[0]?.count
      ).toBe(0);

      const nullId = `rec${randomUUID().replaceAll('-', '').slice(0, 16)}`;
      const attributedId = `rec${randomUUID().replaceAll('-', '').slice(0, 16)}`;
      await observer.query(
        `INSERT INTO "${baseId}"."outer_commit" ("__id", "__created_by", "__version") VALUES ($1, 'system', 1)`,
        [nullId]
      );
      await observer.query(
        `INSERT INTO "${baseId}"."outer_commit" ("__id", "__created_by", "__version", "__created_by_actor_type", "__created_by_actor_id", "__last_modified_by_actor_type", "__last_modified_by_actor_id") VALUES ($1, 'system', 1, 'user', 'usr_creator', 'appUser', 'apu_modifier')`,
        [attributedId]
      );
      const rows = await observer.query<
        { id: string } & Record<
          'created_type' | 'created_id' | 'modified_type' | 'modified_id',
          string | null
        >
      >(`SELECT "__id" AS id, "__created_by_actor_type" AS created_type, "__created_by_actor_id" AS created_id,
        "__last_modified_by_actor_type" AS modified_type, "__last_modified_by_actor_id" AS modified_id
        FROM "${baseId}"."outer_commit"`);
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows.find((row) => row.id === nullId)).toEqual({
        id: nullId,
        created_type: null,
        created_id: null,
        modified_type: null,
        modified_id: null,
      });
      expect(rows.rows.find((row) => row.id === attributedId)).toEqual({
        id: attributedId,
        created_type: 'user',
        created_id: 'usr_creator',
        modified_type: 'appUser',
        modified_id: 'apu_modifier',
      });
    });

    it('does not run capability publication when the outer physical CREATE transaction rolls back', async () => {
      let created: ITableVo | undefined;
      const rollback = new Error('Rollback the actual outer data transaction');
      await expect(
        request(() =>
          data.$tx(async (transaction) => {
            created = await service.createTable(baseId, input('outer_rollback'));
            const visibleInside = await transaction.$queryRawUnsafe<
              Array<{ relation: string | null }>
            >('SELECT to_regclass($1)::text AS relation', `${baseId}.outer_rollback`);
            expect(visibleInside[0]?.relation).not.toBeNull();
            expect(created.actorStorageVersion).toBe(0);
            expect(await metadata(created.id)).toEqual({
              actor_storage_version: 0,
              provision_state: 'pending',
            });
            throw rollback;
          })
        )
      ).rejects.toBe(rollback);

      expect(created).toBeDefined();
      expect(created!.actorStorageVersion).toBe(0);
      expect(await metadata(created!.id)).toEqual({
        actor_storage_version: 0,
        provision_state: 'error',
      });
      const absent = await observer.query<{ relation: string | null }>(
        'SELECT to_regclass($1)::text AS relation',
        [`${baseId}.outer_rollback`]
      );
      expect(absent.rows[0]?.relation).toBeNull();
    });

    it('keeps metadata disabled and records error after real CREATE DDL fails', async () => {
      await observer.query(`CREATE TABLE "${baseId}"."ddl_collision" (marker text)`);
      await expect(
        request(() =>
          data.$tx(async () => {
            await service.createTable(baseId, input('ddl_collision'));
          })
        )
      ).rejects.toThrow();

      const failed = await meta.tableMeta.findFirstOrThrow({
        where: { baseId, name: 'ddl_collision' },
      });
      expect(await metadata(failed.id)).toEqual({
        actor_storage_version: 0,
        provision_state: 'error',
      });
      const columns = await observer.query<Record<'column_name', string>>(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
        [baseId, 'ddl_collision']
      );
      expect(columns.rows.map((column) => column.column_name)).toEqual(['marker']);
    });

    it.each(['commit', 'rollback'] as const)(
      'uses the actual shared metadata owner for default-route %s',
      async (outcome) => {
        let created: ITableVo | undefined;
        const name = `shared_${outcome}`;
        const rollback = new Error('Rollback shared metadata and DDL');
        const work = request(() =>
          meta.$tx(async (transaction) => {
            created = await service.createTable(baseId, input(name));
            expect(created.actorStorageVersion).toBe(0);
            expect(await metadata(created.id)).toBeUndefined();
            expect(
              await transaction.tableMeta.findUnique({ where: { id: created.id } })
            ).toMatchObject({ actorStorageVersion: 0, provisionState: 'pending' });
            if (outcome === 'rollback') throw rollback;
          })
        );
        if (outcome === 'rollback') await expect(work).rejects.toBe(rollback);
        else await work;

        expect(created).toBeDefined();
        const visible = await observer.query<{ relation: string | null }>(
          'SELECT to_regclass($1)::text AS relation',
          [`${baseId}.${name}`]
        );
        if (outcome === 'rollback') {
          expect(await metadata(created!.id)).toBeUndefined();
          expect(visible.rows[0]?.relation).toBeNull();
          expect(created!.actorStorageVersion).toBe(0);
        } else {
          expect(await metadata(created!.id)).toEqual({
            actor_storage_version: 1,
            provision_state: 'ready',
          });
          expect(visible.rows[0]?.relation).not.toBeNull();
          expect(created!.actorStorageVersion).toBe(1);
        }
      }
    );

    it.each(['data', 'meta', 'scoped'] as const)(
      'does not classify a fallible post-commit callback as %s rollback',
      async (owner) => {
        const scoped =
          owner === 'scoped'
            ? createScopedDataPrismaClient(
                registry.acquire(databaseUrl!),
                new URL(databaseUrl!).searchParams.get('schema') ?? 'public'
              )
            : undefined;
        const transactionOwner = scoped ?? (owner === 'meta' ? meta : data);
        const rollback = vi.fn(async () => undefined);
        const failure = new Error('Post-commit delivery failed');
        try {
          await expect(
            request(() =>
              transactionOwner.$tx(async (transaction) => {
                // Register the failing callback first: the rollback marker must run before it.
                expect(
                  transactionOwner.afterCommit(async () => {
                    throw failure;
                  })
                ).toBe(true);
                expect(transactionOwner.afterRollback(rollback)).toBe(true);
                await transaction.$queryRawUnsafe('SELECT 1');
              })
            )
          ).rejects.toBe(failure);
          expect(rollback).not.toHaveBeenCalled();
        } finally {
          await scoped?.$disconnect();
        }
      }
    );

    it('runs scoped rollback callbacks only after its actual transaction rolls back', async () => {
      const scoped = createScopedDataPrismaClient(
        registry.acquire(databaseUrl!),
        new URL(databaseUrl!).searchParams.get('schema') ?? 'public'
      );
      const failure = new Error('Rollback scoped DDL');
      let rolledBack = false;
      try {
        await expect(
          scoped.$tx(async (transaction) => {
            await transaction.$executeRawUnsafe(
              `CREATE TABLE "${baseId}"."scoped_rollback" (marker text)`
            );
            expect(
              scoped.afterRollback(async () => {
                const result = await observer.query<{ relation: string | null }>(
                  'SELECT to_regclass($1)::text AS relation',
                  [`${baseId}.scoped_rollback`]
                );
                expect(result.rows[0]?.relation).toBeNull();
                rolledBack = true;
              })
            ).toBe(true);
            expect(rolledBack).toBe(false);
            throw failure;
          })
        ).rejects.toBe(failure);
        expect(rolledBack).toBe(true);
      } finally {
        await scoped.$disconnect();
      }
    });

    it('permanently retires a scoped client without preventing its already-active transaction from finishing', async () => {
      const scoped = createScopedDataPrismaClient(
        registry.acquire(databaseUrl!),
        new URL(databaseUrl!).searchParams.get('schema') ?? 'public'
      );
      const retainedDelegate = scoped.recordTrash;
      let retirement: Promise<void> | undefined;
      try {
        await scoped.$tx(async (transaction) => {
          retirement = scoped.$disconnect();
          await retirement;
          expect(scoped.txClient()).toBe(transaction);
          await scoped.$tx(async (nested) => {
            expect(nested).toBe(transaction);
            await nested.$queryRawUnsafe('SELECT 1');
          });
          await scoped.$queryRawUnsafe('SELECT 1');
          await retainedDelegate.count({ where: { tableId: 'tblNoSuchRetiredFixture' } });
        });
        await retirement;
        await expect(scoped.$tx(async () => undefined)).rejects.toThrow('has been retired');
        await expect(scoped.$queryRawUnsafe('SELECT 1')).rejects.toThrow('has been retired');
        await expect(async () => scoped.$connect()).rejects.toThrow('has been retired');
        await expect(async () => retainedDelegate.count()).rejects.toThrow('has been retired');
        expect(() => scoped.txClient()).toThrow('has been retired');
      } finally {
        await retirement;
        await scoped.$disconnect();
      }
    });

    it('waits for every active root transaction before physical retirement completes', async () => {
      const scoped = createScopedDataPrismaClient(
        registry.acquire(databaseUrl!),
        new URL(databaseUrl!).searchParams.get('schema') ?? 'public'
      );
      const firstEntered = deferred();
      const secondEntered = deferred();
      const finishFirst = deferred();
      const finishSecond = deferred();
      const first = scoped.$tx(async (transaction) => {
        firstEntered.resolve();
        await finishFirst.promise;
        await transaction.$queryRawUnsafe('SELECT 1');
      });
      const second = scoped.$tx(async (transaction) => {
        secondEntered.resolve();
        await finishSecond.promise;
        await transaction.$queryRawUnsafe('SELECT 1');
      });
      let retirementCompleted = false;
      try {
        await Promise.all([firstEntered.promise, secondEntered.promise]);
        const retirement = scoped.$disconnect().then(() => {
          retirementCompleted = true;
        });
        await expect(scoped.$queryRawUnsafe('SELECT 1')).rejects.toThrow('has been retired');
        finishFirst.resolve();
        await first;
        expect(retirementCompleted).toBe(false);
        finishSecond.resolve();
        await second;
        await retirement;
        expect(retirementCompleted).toBe(true);
      } finally {
        finishFirst.resolve();
        finishSecond.resolve();
        await Promise.allSettled([first, second]);
        await scoped.$disconnect();
      }
    });
  }
);
