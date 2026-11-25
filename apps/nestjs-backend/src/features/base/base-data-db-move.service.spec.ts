import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseDataDbMoveService } from './base-data-db-move.service';

const pg = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn(), connect: vi.fn() }));
vi.mock('pg', () => ({
  Client: class {
    query = pg.query;
    end = pg.end;
    connect = pg.connect;
  },
}));

describe('BaseDataDbMoveService', () => {
  const prismaService = {
    txClient: vi.fn(),
    base: {
      findUniqueOrThrow: vi.fn(),
    },
    baseDataDbMoveJob: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    spaceDataDbMigrationJob: {
      findFirst: vi.fn(),
    },
    spaceDataDbBinding: {
      findUnique: vi.fn(),
    },
    tableMeta: {
      findMany: vi.fn(),
    },
  };

  const dataDbClientManager = {
    getDataDatabaseForSpace: vi.fn(),
  };

  const copyService = {
    assertPostgresToolsAvailable: vi.fn(),
    copyBaseSchemas: vi.fn(),
    copySharedTables: vi.fn(),
  };

  const cls = {
    get: vi.fn(),
    set: vi.fn(),
    run: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  };

  const baseService = {
    applyMetaMoveBase: vi.fn(),
  };

  const spaceDataDbMigrationGuard = {
    assertBaseWritable: vi.fn(),
    assertSpaceWritable: vi.fn(),
  };
  const routingLease = {
    invalidateInTransaction: vi.fn(),
    assertInTransaction: vi.fn(),
    invalidateCaches: vi.fn(),
    release: vi.fn(),
  };
  const actorStorageRouting = { acquire: vi.fn() };

  let service: BaseDataDbMoveService;

  beforeEach(() => {
    vi.restoreAllMocks();
    pg.end.mockReset().mockResolvedValue(undefined);
    pg.connect.mockReset().mockResolvedValue(undefined);
    vi.clearAllMocks();
    actorStorageRouting.acquire.mockReset().mockResolvedValue(routingLease);
    routingLease.invalidateCaches.mockReset().mockResolvedValue(undefined);
    baseService.applyMetaMoveBase.mockReset();
    prismaService.txClient.mockReturnValue({});
    for (const method of Object.values(routingLease)) method.mockClear();
    cls.get.mockImplementation((key?: string) => {
      if (key === 'user.id') return 'usr_test';
      return undefined;
    });
    service = new BaseDataDbMoveService(
      prismaService as never,
      dataDbClientManager as never,
      copyService as never,
      cls as never,
      baseService as never,
      spaceDataDbMigrationGuard as never,
      actorStorageRouting as never
    );
  });

  it('resolveDataDbCheck marks physical move when cacheKeys differ', async () => {
    prismaService.base.findUniqueOrThrow.mockResolvedValue({ id: 'bse1', spaceId: 'spc1' });
    dataDbClientManager.getDataDatabaseForSpace
      .mockResolvedValueOnce({
        cacheKey: 'meta-fallback',
        url: 'postgresql://localhost/teable',
        isMetaFallback: true,
      })
      .mockResolvedValueOnce({
        cacheKey: 'conn_byodb',
        url: 'postgresql://localhost/byodb',
        isMetaFallback: false,
        connectionId: 'conn_byodb',
        internalSchema: 'teable_abc',
      });
    prismaService.spaceDataDbBinding.findUnique.mockResolvedValue({
      dataDbConnection: { displayHost: 'db.example.com', displayDatabase: 'byodb' },
    });

    const result = await service.resolveDataDbCheck('bse1', 'spc2');

    expect(result.sameDataDb).toBe(false);
    expect(result.requiresPhysicalMove).toBe(true);
    expect(result.source.mode).toBe('default');
    expect(result.target.mode).toBe('byodb');
  });

  it('resolveDataDbCheck does not require physical move when cacheKeys match', async () => {
    prismaService.base.findUniqueOrThrow.mockResolvedValue({ id: 'bse1', spaceId: 'spc1' });
    dataDbClientManager.getDataDatabaseForSpace.mockResolvedValue({
      cacheKey: 'meta-fallback',
      url: 'postgresql://localhost/teable',
      isMetaFallback: true,
    });

    const result = await service.resolveDataDbCheck('bse1', 'spc2');

    expect(result.sameDataDb).toBe(true);
    expect(result.requiresPhysicalMove).toBe(false);
  });

  it('startPhysicalMove creates job and returns jobId', async () => {
    prismaService.base.findUniqueOrThrow.mockResolvedValue({ id: 'bse1', spaceId: 'spc1' });
    prismaService.spaceDataDbMigrationJob.findFirst.mockResolvedValue(null);
    prismaService.baseDataDbMoveJob.findFirst.mockResolvedValue(null);
    prismaService.tableMeta.findMany.mockResolvedValue([{ id: 'tbl1', dbTableName: 'bse1.tbl1' }]);
    dataDbClientManager.getDataDatabaseForSpace
      .mockResolvedValueOnce({
        cacheKey: 'meta-fallback',
        url: 'postgresql://localhost/teable',
        isMetaFallback: true,
      })
      .mockResolvedValueOnce({
        cacheKey: 'conn_byodb',
        url: 'postgresql://localhost/byodb',
        isMetaFallback: false,
        connectionId: 'conn_byodb',
        internalSchema: 'teable_abc',
      });
    prismaService.baseDataDbMoveJob.create.mockResolvedValue({ id: 'job1' });
    vi.spyOn(service, 'runMoveJob').mockResolvedValue(undefined);

    const result = await service.startPhysicalMove('bse1', 'spc2');

    expect(result).toEqual({ jobId: 'job1', async: true });
    expect(prismaService.baseDataDbMoveJob.create).toHaveBeenCalled();
    expect(spaceDataDbMigrationGuard.assertBaseWritable).toHaveBeenCalledWith('bse1');
    expect(spaceDataDbMigrationGuard.assertSpaceWritable).toHaveBeenCalledWith('spc2');
  });

  const inventory = {
    baseId: 'bse1',
    sourceSpaceId: 'spc1',
    targetSpaceId: 'spc2',
    tableIds: ['tbl1'],
    dbTableNames: ['bse1.records'],
    sourceInternalSchema: 'public',
    targetInternalSchema: 'public',
    sourceCacheKey: 'source',
    targetCacheKey: 'target',
  };

  const preparePhysicalMove = () => {
    let targetBound = false;
    let schemaProbes = 0;
    pg.query.mockImplementation(async (sql: string) => ({
      rows: [
        {
          exists: sql.includes('pg_namespace') ? schemaProbes++ > 0 : false,
        },
      ],
    }));
    prismaService.baseDataDbMoveJob.findUnique.mockResolvedValue({
      id: 'job1',
      state: 'switching',
      inventory,
      createdBy: 'usr_test',
    });
    prismaService.base.findUniqueOrThrow.mockImplementation(async () => ({
      spaceId: targetBound ? 'spc2' : 'spc1',
    }));
    dataDbClientManager.getDataDatabaseForSpace.mockImplementation(async (spaceId: string) => ({
      cacheKey: spaceId === 'spc1' ? 'source' : 'target',
      url: `postgresql://localhost/${spaceId}`,
    }));
    copyService.copySharedTables.mockResolvedValue([]);
    baseService.applyMetaMoveBase.mockImplementation(async (_base, _space, options) => {
      await options.beforeDataDbSwitch();
      targetBound = true;
    });
  };

  it('holds target verification and stale task invalidation until committed cutover caches are retired', async () => {
    preparePhysicalMove();
    await service.runMoveJob('job1');
    expect(actorStorageRouting.acquire).toHaveBeenCalledWith(
      ['tbl1'],
      'postgresql://localhost/spc2'
    );
    expect(routingLease.invalidateInTransaction).toHaveBeenCalledWith(prismaService.txClient());
    expect(routingLease.invalidateCaches).toHaveBeenCalledWith(['source', 'target']);
    expect(prismaService.baseDataDbMoveJob.update).toHaveBeenLastCalledWith({
      where: { id: 'job1' },
      data: expect.objectContaining({ state: 'succeeded' }),
    });
    expect(routingLease.release.mock.invocationCallOrder[0]).toBeGreaterThan(
      routingLease.invalidateCaches.mock.invocationCallOrder[0]
    );
  });

  it('does not switch when strict destination catalog verification fails', async () => {
    preparePhysicalMove();
    actorStorageRouting.acquire.mockRejectedValue(
      new Error('Destination actor columns are missing')
    );
    await expect(service.runMoveJob('job1')).rejects.toThrow('columns are missing');
    expect(routingLease.invalidateInTransaction).not.toHaveBeenCalled();
    expect(prismaService.baseDataDbMoveJob.update).toHaveBeenLastCalledWith({
      where: { id: 'job1' },
      data: expect.objectContaining({ state: 'failed' }),
    });
  });

  it('never deletes the committed destination when cache retirement fails', async () => {
    preparePhysicalMove();
    routingLease.invalidateCaches.mockRejectedValue(new Error('cache unavailable'));
    await expect(service.runMoveJob('job1')).rejects.toThrow('cache unavailable');
    expect(prismaService.baseDataDbMoveJob.update).toHaveBeenLastCalledWith({
      where: { id: 'job1' },
      data: { state: 'switching', lastError: 'cache unavailable' },
    });
    expect(pg.query.mock.calls.some(([sql]) => String(sql).startsWith('DROP SCHEMA'))).toBe(false);
    expect(routingLease.release).toHaveBeenCalledOnce();
  });

  it('finalizes an already committed route without recopying or dropping target data', async () => {
    preparePhysicalMove();
    prismaService.base.findUniqueOrThrow.mockResolvedValue({ spaceId: 'spc2' });
    await service.runMoveJob('job1');
    expect(copyService.copyBaseSchemas).not.toHaveBeenCalled();
    expect(baseService.applyMetaMoveBase).not.toHaveBeenCalled();
    expect(actorStorageRouting.acquire).toHaveBeenCalledOnce();
    expect(prismaService.baseDataDbMoveJob.update).toHaveBeenLastCalledWith({
      where: { id: 'job1' },
      data: expect.objectContaining({ state: 'succeeded' }),
    });
  });

  it('retries finalization through the existing job endpoint without target cleanup', async () => {
    const job = {
      id: 'job1',
      baseId: 'bse1',
      sourceSpaceId: 'spc1',
      targetSpaceId: 'spc2',
      inventory,
      state: 'switching',
      createdTime: new Date(),
      startedAt: null,
      completedAt: null,
      copyStats: null,
      validationStats: null,
      lastError: 'cache unavailable',
    };
    prismaService.baseDataDbMoveJob.findFirst.mockResolvedValue(job);
    prismaService.baseDataDbMoveJob.update.mockResolvedValue(job);
    prismaService.base.findUniqueOrThrow.mockResolvedValue({ spaceId: 'spc2' });
    const run = vi.spyOn(service, 'runMoveJob').mockResolvedValue(undefined);
    await expect(service.retryJob('bse1', 'job1')).resolves.toMatchObject({ state: 'switching' });
    expect(pg.query).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith('job1');
    expect(prismaService.baseDataDbMoveJob.update).toHaveBeenCalledWith({
      where: { id: 'job1' },
      data: expect.objectContaining({ state: 'switching' }),
    });
  });
});
