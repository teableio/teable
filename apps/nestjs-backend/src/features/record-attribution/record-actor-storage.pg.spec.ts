import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataPrismaService } from '@teable/db-data-prisma';
import { defaultPgPoolFactory, PgPoolRegistry, PrismaService } from '@teable/db-main-prisma';
import { V2PgTableSchemaCoordination } from '@teable/v2-adapter-db-postgres-pg';
import { ActorId } from '@teable/v2-core';
import { ClsService } from 'nestjs-cls';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IClsStore } from '../../types/cls';
import { RecordActorStorageService } from './record-actor-storage.service';

// Explicit owner-provisioned official Prisma schema only. Never fall back to a
// developer/customer URL, create a database, or bootstrap look-alike SQL tables.
const ownedUrl = process.env.RECORD_ACTOR_PG_URL;
const actorContext = { actorId: ActorId.create('system')._unsafeUnwrap() };
const v2ApplicationName = 'app-platform-record-actor-v2-proof';
const metadataTable = `"${(ownedUrl ? (new URL(ownedUrl).searchParams.get('schema') ?? 'public') : 'public').replaceAll('"', '""')}"."table_meta"`;

// Backend targets ES2022, which does not declare Promise.withResolvers.
const gate = () => {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
};

const within = async <T>(work: Promise<T>, milliseconds: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Real PostgreSQL coordination exceeded its deadline')),
      milliseconds
    );
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
};

describe.skipIf(!ownedUrl)('RecordActorStorageService real PostgreSQL/Prisma leases', () => {
  let cls: ClsService<IClsStore>;
  let prisma: PrismaService;
  let dataPrisma: DataPrismaService;
  let registry: PgPoolRegistry;
  let observer: Pool;
  let storage: RecordActorStorageService;
  let v2: V2PgTableSchemaCoordination;
  let spaceId: string;
  let baseId: string;
  let tableIds: string[];

  const request = <T>(work: () => T) => cls.runWith({ tx: {}, dataTx: {} } as IClsStore, work);
  const locks = async (tableId: string, applicationName: string, granted: boolean) => {
    const result = await observer.query<{ pid: number; mode: string }>(
      `
      SELECT a.pid, l.mode FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.locktype = 'advisory' AND l.objsubid = 1 AND l.granted = $1
        AND a.application_name = $2
        AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND l.classid::bigint = ((hashtextextended($3, 0) >> 32) & 4294967295)
        AND l.objid::bigint = (hashtextextended($3, 0) & 4294967295)
    `,
      [granted, applicationName, `teable.schema:table:${tableId}`]
    );
    return result.rows;
  };

  beforeAll(async () => {
    if (!ownedUrl)
      throw new Error('RECORD_ACTOR_PG_URL must name the owned official Prisma schema');
    cls = new ClsService<IClsStore>(new AsyncLocalStorage());
    registry = new PgPoolRegistry(defaultPgPoolFactory);
    const lease = registry.acquire(ownedUrl, {
      max: 16,
      applicationName: 'app-platform-record-actor-prisma-proof',
    });
    observer = lease.pool;
    const schema = new URL(ownedUrl).searchParams.get('schema') ?? 'public';
    // Same concrete ALS instance is used by the host helper and NamedPrismaService.
    prisma = new PrismaService(cls as never, lease, schema);
    await prisma.$connect();
    dataPrisma = new DataPrismaService(
      cls as never,
      registry.acquire(ownedUrl, {
        max: 16,
        applicationName: 'app-platform-record-actor-prisma-proof',
      }),
      schema
    );
    await dataPrisma.$connect();
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    spaceId = `spc${suffix}`;
    baseId = `bse${suffix}`;
    tableIds = Array.from(
      { length: 12 },
      (_value, index) => `tbl${suffix.slice(0, 14)}${index.toString().padStart(2, '0')}`
    );
    await prisma.space.create({
      data: { id: spaceId, name: 'app platform official-schema lease proof', createdBy: 'system' },
    });
    await prisma.base.create({
      data: {
        id: baseId,
        spaceId,
        name: 'app platform helper proof',
        order: 1,
        createdBy: 'system',
      },
    });
    await prisma.tableMeta.createMany({
      data: tableIds.map((id, index) => ({
        id,
        baseId,
        name: `Actor lease ${index}`,
        dbTableName: `${baseId}.${id}`,
        version: 1,
        actorStorageVersion: 0,
        order: index,
        createdBy: 'system',
        provisionState: 'ready',
      })),
    });
    v2 = new V2PgTableSchemaCoordination({
      connectionString: ownedUrl,
      applicationName: v2ApplicationName,
    });
  });

  beforeEach(async () => {
    storage = new RecordActorStorageService(
      prisma,
      cls,
      new ConfigService({ PRISMA_META_DATABASE_URL: ownedUrl })
    );
    await prisma.tableMeta.updateMany({
      where: { id: { in: tableIds } },
      data: { actorStorageVersion: 0 },
    });
  });
  afterEach(async () => {
    await storage?.onModuleDestroy();
  });
  afterAll(async () => {
    await v2?.destroy();
    if (prisma) {
      await prisma.tableMeta.deleteMany({ where: { id: { in: tableIds ?? [] } } });
      if (baseId) await prisma.base.deleteMany({ where: { id: baseId } });
      if (spaceId) await prisma.space.deleteMany({ where: { id: spaceId } });
      await prisma.onModuleDestroy();
    }
    await dataPrisma?.onModuleDestroy();
    await registry?.onApplicationShutdown();
  });

  it('reuses the shared metadata root transaction in the actual routed data package and checks leases before it commits', async () => {
    const tableId = tableIds[7];
    const original = await prisma.tableMeta.findUniqueOrThrow({ where: { id: tableId } });
    const failure = new Error('Expected shared-root rollback');
    await expect(
      request(() =>
        prisma.$tx(async (metaTx) => {
          // Shared meta/data deployment: the routed package has no data transaction
          // of its own and must write through the metadata root client.
          expect(cls.get('tx')?.client).toBeDefined();
          await dataPrisma.$tx(async (dataTx) => {
            expect(cls.get('dataTx')?.client).toBeUndefined();
            await dataTx.$executeRawUnsafe(
              `UPDATE ${metadataTable} SET name = $1 WHERE id = $2`,
              'shared root write',
              tableId
            );
          });
          await storage.withTableWrite(tableId, async (table) => {
            expect(table.dbTableName).toBe(original.dbTableName);
            await metaTx.tableMeta.update({
              where: { id: tableId },
              data: { name: 'before shared rollback' },
            });
          });
          expect(await locks(tableId, 'teable-record-actor-storage', true)).toHaveLength(1);
          throw failure;
        })
      )
    ).rejects.toBe(failure);
    expect((await prisma.tableMeta.findUniqueOrThrow({ where: { id: tableId } })).name).toBe(
      original.name
    );
    expect(await locks(tableId, 'teable-record-actor-storage', true)).toHaveLength(0);
  });

  it('allows a provisioning target only through the explicit option while keeping the commit guard registered', async () => {
    const tableId = tableIds[8];
    await prisma.tableMeta.update({ where: { id: tableId }, data: { provisionState: 'pending' } });
    try {
      await expect(
        request(() => storage.withTableWrite(tableId, async () => undefined))
      ).rejects.toThrow('Table not found');
      await request(() =>
        dataPrisma.$tx(async () => {
          await storage.withTableWrite(
            tableId,
            async (table) => {
              expect(table.id).toBe(tableId);
              expect(cls.get('dataTx')?.schemaLeaseChecks?.size ?? 0).toBeGreaterThan(0);
            },
            { provisioning: true }
          );
          expect(await locks(tableId, 'teable-record-actor-storage', true)).toHaveLength(1);
        })
      );
      expect(await locks(tableId, 'teable-record-actor-storage', true)).toHaveLength(0);
    } finally {
      await prisma.tableMeta.update({ where: { id: tableId }, data: { provisionState: 'ready' } });
    }
  });

  it('holds the exact v2 advisory namespace until outer DataPrisma COMMIT, not the inner action return', async () => {
    const tableId = tableIds[0];
    const innerReturned = gate();
    const finishTransaction = gate();
    const writer = request(() =>
      dataPrisma.$tx(
        async (tx) => {
          await storage.withTableWrite(tableId, async (table) => {
            expect(table.actorStorageVersion).toBe(0);
            await tx.$executeRawUnsafe(
              `UPDATE ${metadataTable} SET name = $1 WHERE id = $2`,
              'confirmed outer commit',
              tableId
            );
          });
          innerReturned.open();
          await finishTransaction.wait;
        },
        { timeout: 15_000 }
      )
    );
    const writerOutcome = writer.then(
      () => undefined,
      (error: unknown) => error
    );
    await innerReturned.wait;
    const exclusive = v2.acquire(actorContext, [tableId], 'exclusive');
    try {
      await vi.waitFor(
        async () => {
          expect(await locks(tableId, v2ApplicationName, false)).toHaveLength(1);
          expect(await locks(tableId, 'teable-record-actor-storage', true)).toHaveLength(1);
        },
        { timeout: 2_000, interval: 20 }
      );
      finishTransaction.open();
      expect(await writerOutcome).toBeUndefined();
      const lease = (await within(exclusive, 2_000))._unsafeUnwrap();
      try {
        expect((await prisma.tableMeta.findUniqueOrThrow({ where: { id: tableId } })).name).toBe(
          'confirmed outer commit'
        );
      } finally {
        await lease.release();
      }
    } finally {
      finishTransaction.open();
      await writerOutcome;
      const acquired = await exclusive;
      if (acquired.isOk()) await acquired.value.release();
    }
  });

  it('releases only after outer Prisma ROLLBACK has completed on an exception', async () => {
    const tableId = tableIds[1];
    const original = await prisma.tableMeta.findUniqueOrThrow({ where: { id: tableId } });
    const innerReturned = gate();
    const finishTransaction = gate();
    const failure = new Error('Expected outer rollback');
    const writer = request(() =>
      prisma.$tx(
        async (tx) => {
          await storage.withTableWrite(tableId, async () => {
            await tx.tableMeta.update({ where: { id: tableId }, data: { name: 'must rollback' } });
          });
          innerReturned.open();
          await finishTransaction.wait;
          throw failure;
        },
        { timeout: 15_000 }
      )
    );
    const outcome = writer.then(
      () => undefined,
      (error: unknown) => error
    );
    await innerReturned.wait;
    const exclusive = v2.acquire(actorContext, [tableId], 'exclusive');
    try {
      await vi.waitFor(
        async () => expect(await locks(tableId, v2ApplicationName, false)).toHaveLength(1),
        { timeout: 2_000, interval: 20 }
      );
      finishTransaction.open();
      expect(await outcome).toBe(failure);
      const lease = (await within(exclusive, 2_000))._unsafeUnwrap();
      try {
        expect((await prisma.tableMeta.findUniqueOrThrow({ where: { id: tableId } })).name).toBe(
          original.name
        );
      } finally {
        await lease.release();
      }
    } finally {
      finishTransaction.open();
      await outcome;
      const acquired = await exclusive;
      if (acquired.isOk()) await acquired.value.release();
    }
  });

  it('reloads version 1 metadata after waiting behind an exclusive enable publication', async () => {
    const tableId = tableIds[2];
    const before = await prisma.tableMeta.findUniqueOrThrow({ where: { id: tableId } });
    expect(before.actorStorageVersion).toBe(0);
    const exclusive = (await v2.acquire(actorContext, [tableId], 'exclusive'))._unsafeUnwrap();
    const writer = request(() => storage.withTableWrite(tableId, async (table) => table));
    try {
      await vi.waitFor(
        async () =>
          expect(await locks(tableId, 'teable-record-actor-storage', false)).toHaveLength(1),
        { timeout: 2_000, interval: 20 }
      );
      await prisma.tableMeta.update({ where: { id: tableId }, data: { actorStorageVersion: 1 } });
      await exclusive.release();
      expect(await within(writer, 2_000)).toMatchObject({ id: tableId, actorStorageVersion: 1 });
    } finally {
      await exclusive.release();
      await writer;
    }
  });

  it('reuses one physical coordination connection for nested same-table writers', async () => {
    const tableId = tableIds[3];
    await request(() =>
      storage.withTableWrite(tableId, async (outer) => {
        const original = await locks(tableId, 'teable-record-actor-storage', true);
        expect(original).toHaveLength(1);
        await storage.withTableWrite(tableId, async (inner) => {
          expect(inner).toBe(outer);
          const nested = await locks(tableId, 'teable-record-actor-storage', true);
          expect(nested).toEqual(original);
        });
        expect(await locks(tableId, 'teable-record-actor-storage', true)).toEqual(original);
      })
    );
    expect(await locks(tableId, 'teable-record-actor-storage', true)).toHaveLength(0);
  });

  it('reuses transaction-held same-table leases across more than eight sequential operations', async () => {
    const tableId = tableIds[4];
    const writer = request(() =>
      prisma.$tx(
        async () => {
          let firstPid: number | undefined;
          for (let index = 0; index < 12; index += 1) {
            await storage.withTableWrite(tableId, async () => {
              const rows = await locks(tableId, 'teable-record-actor-storage', true);
              expect(rows).toHaveLength(1);
              firstPid ??= rows[0].pid;
              expect(rows[0].pid).toBe(firstPid);
            });
          }
        },
        { timeout: 15_000 }
      )
    );
    const outcome = writer.then(
      () => undefined,
      (error: unknown) => error
    );
    try {
      await within(writer, 3_000);
      expect(await locks(tableId, 'teable-record-actor-storage', true)).toHaveLength(0);
    } finally {
      await storage.onModuleDestroy();
      await outcome;
    }
  });

  it('uses one pinned backend for a declared twelve-table outer transaction', async () => {
    const writer = request(() =>
      prisma.$tx(
        async () => {
          await storage.withTablesWrite([...tableIds].reverse(), async (tables) => {
            expect(tables.map((table) => table.id).sort()).toEqual([...tableIds].sort());
            let backendPid: number | undefined;
            for (const tableId of tableIds) {
              await storage.withTableWrite(tableId, async (table) => {
                expect(table.actorStorageVersion).toBe(0);
                const held = await locks(tableId, 'teable-record-actor-storage', true);
                expect(held).toHaveLength(1);
                backendPid ??= held[0].pid;
                expect(held[0].pid).toBe(backendPid);
              });
            }
          });
          const heldBackends = new Set<number>();
          for (const tableId of tableIds) {
            const held = await locks(tableId, 'teable-record-actor-storage', true);
            expect(held).toHaveLength(1);
            heldBackends.add(held[0].pid);
          }
          expect(heldBackends.size).toBe(1);
        },
        { timeout: 15_000 }
      )
    );
    const outcome = writer.then(
      () => undefined,
      (error: unknown) => error
    );
    try {
      await within(writer, 3_000);
      for (const tableId of tableIds)
        expect(await locks(tableId, 'teable-record-actor-storage', true)).toHaveLength(0);
    } finally {
      await storage.onModuleDestroy();
      await outcome;
    }
  });

  it('rejects an undeclared actual-write target before entering its writer callback', async () => {
    let enteredUndeclaredWriter = false;
    await request(() =>
      prisma.$tx(async () => {
        await storage.withTablesWrite([tableIds[0]], async () => {
          await expect(
            storage.withTableWrite(tableIds[1], async () => {
              enteredUndeclaredWriter = true;
            })
          ).rejects.toThrow();
          expect(enteredUndeclaredWriter).toBe(false);
          expect(await locks(tableIds[1], 'teable-record-actor-storage', true)).toHaveLength(0);
          expect(await locks(tableIds[0], 'teable-record-actor-storage', true)).toHaveLength(1);
        });
      })
    );
  });

  it('bounds a real locked writer using the production default PostgreSQL lock timeout', async () => {
    const tableId = tableIds[5];
    const exclusive = (await v2.acquire(actorContext, [tableId], 'exclusive'))._unsafeUnwrap();
    let enteredWriter = false;
    const started = Date.now();
    const writer = request(() =>
      storage.withTableWrite(tableId, async () => {
        enteredWriter = true;
      })
    );
    const outcome = writer.then(
      () => undefined,
      (error: unknown) => error
    );
    try {
      await vi.waitFor(
        async () =>
          expect(await locks(tableId, 'teable-record-actor-storage', false)).toHaveLength(1),
        { timeout: 1_000, interval: 20 }
      );
      expect(await within(outcome, 5_000)).toBeInstanceOf(ServiceUnavailableException);
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(enteredWriter).toBe(false);
      expect(await locks(tableId, 'teable-record-actor-storage', true)).toHaveLength(0);
    } finally {
      await exclusive.release();
      await outcome;
    }
  }, 10_000);

  it('rolls back the real data transaction when its holding backend dies after the writer callback', async () => {
    const tableId = tableIds[6];
    const original = await prisma.tableMeta.findUniqueOrThrow({ where: { id: tableId } });
    const actionReturned = gate();
    const finishTransaction = gate();
    let checkHeld: (() => void | Promise<void>) | undefined;
    const writer = request(() =>
      dataPrisma.$tx(
        async (tx) => {
          await storage.withTableWrite(tableId, async () => {
            await tx.$executeRawUnsafe(
              `UPDATE ${metadataTable} SET name = $1 WHERE id = $2`,
              'must not commit after schema lease loss',
              tableId
            );
          });
          const scope = cls.get('dataTx')?.actorStorageScope;
          if (!scope)
            throw new Error('Expected the actual outer transaction to own the actor lease scope');
          checkHeld = () => scope.assertHeld();
          actionReturned.open();
          await finishTransaction.wait;
          // No further writer/helper call: the Prisma pre-COMMIT check must catch loss.
        },
        { timeout: 15_000 }
      )
    );
    const outcome = writer.then(
      () => undefined,
      (error: unknown) => error
    );
    try {
      await within(actionReturned.wait, 2_000);
      const held = await locks(tableId, 'teable-record-actor-storage', true);
      expect(held).toHaveLength(1);
      await observer.query('SELECT pg_terminate_backend($1)', [held[0].pid]);
      await vi.waitFor(
        async () => {
          const check = checkHeld;
          if (!check) throw new Error('Expected a transaction-owned local liveness check');
          await expect(Promise.resolve().then(() => check())).rejects.toBeInstanceOf(
            ServiceUnavailableException
          );
        },
        { timeout: 2_000, interval: 20 }
      );
      finishTransaction.open();
      expect(await within(outcome, 3_000)).toBeInstanceOf(ServiceUnavailableException);
      expect((await prisma.tableMeta.findUniqueOrThrow({ where: { id: tableId } })).name).toBe(
        original.name
      );
      expect(await locks(tableId, 'teable-record-actor-storage', true)).toHaveLength(0);
      expect(await locks(tableId, 'teable-record-actor-storage', false)).toHaveLength(0);
      const afterRollback = (
        await within(v2.acquire(actorContext, [tableId], 'exclusive'), 2_000)
      )._unsafeUnwrap();
      await afterRollback.release();
    } finally {
      finishTransaction.open();
      await outcome;
    }
  });
});
