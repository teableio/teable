import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseDataDbMoveService } from './base-data-db-move.service';

describe('BaseDataDbMoveService', () => {
  const prismaService = {
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

  let service: BaseDataDbMoveService;

  beforeEach(() => {
    vi.clearAllMocks();
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
      spaceDataDbMigrationGuard as never
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
});
