import { describe, expect, it, vi } from 'vitest';
import { encryptDataDbUrl } from '../features/space/data-db-url-secret';
import { DataDbClientManager } from './data-db-client-manager.service';
import { DataDbRuntimeCacheService } from './data-db-runtime-cache.service';

const withTxClient = <T extends object>(txClient: T) => ({
  ...txClient,
  txClient: vi.fn(() => txClient),
});

describe('DataDbClientManager', () => {
  it('falls back to the meta DB clients when a space has no BYODB binding', async () => {
    const prismaService = withTxClient({
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    });
    const metaFallbackDataPrisma = {};
    const metaFallbackDataKnex = {};
    const manager = new DataDbClientManager(
      prismaService as never,
      metaFallbackDataPrisma as never,
      metaFallbackDataKnex as never,
      new DataDbRuntimeCacheService()
    );

    await expect(manager.dataPrismaForSpace('spcxxx')).resolves.toBe(metaFallbackDataPrisma);
    await expect(manager.dataKnexForSpace('spcxxx')).resolves.toBe(metaFallbackDataKnex);
  });

  it('resolves base scoped clients through the base space', async () => {
    const prismaService = withTxClient({
      base: {
        findUnique: vi.fn().mockResolvedValue({ spaceId: 'spcxxx' }),
      },
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    });
    const metaFallbackDataPrisma = {};
    const metaFallbackDataKnex = {};
    const manager = new DataDbClientManager(
      prismaService as never,
      metaFallbackDataPrisma as never,
      metaFallbackDataKnex as never,
      new DataDbRuntimeCacheService()
    );

    await expect(manager.dataPrismaForBase('bsexxx')).resolves.toBe(metaFallbackDataPrisma);
    await expect(manager.dataKnexForBase('bsexxx')).resolves.toBe(metaFallbackDataKnex);
    expect(prismaService.base.findUnique).toHaveBeenCalledWith({
      where: { id: 'bsexxx' },
      select: { spaceId: true },
    });
    expect(prismaService.txClient).not.toHaveBeenCalled();
  });

  it('resolves table scoped clients through the table base space', async () => {
    const prismaService = withTxClient({
      tableMeta: {
        findUnique: vi.fn().mockResolvedValue({ base: { spaceId: 'spcxxx' } }),
      },
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    });
    const metaFallbackDataPrisma = {};
    const metaFallbackDataKnex = {};
    const manager = new DataDbClientManager(
      prismaService as never,
      metaFallbackDataPrisma as never,
      metaFallbackDataKnex as never,
      new DataDbRuntimeCacheService()
    );

    await expect(manager.dataPrismaForTable('tblxxx')).resolves.toBe(metaFallbackDataPrisma);
    await expect(manager.dataKnexForTable('tblxxx')).resolves.toBe(metaFallbackDataKnex);
    expect(prismaService.tableMeta.findUnique).toHaveBeenCalledWith({
      where: { id: 'tblxxx' },
      select: { base: { select: { spaceId: true } } },
    });
    expect(prismaService.txClient).not.toHaveBeenCalled();
  });

  it('uses the active transaction when explicitly requested', async () => {
    const txClient = {
      tableMeta: {
        findUnique: vi.fn().mockResolvedValue({ base: { spaceId: 'spc_in_tx' } }),
      },
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const prismaService = {
      ...withTxClient(txClient),
      tableMeta: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const metaFallbackDataPrisma = {};
    const metaFallbackDataKnex = {};
    const manager = new DataDbClientManager(
      prismaService as never,
      metaFallbackDataPrisma as never,
      metaFallbackDataKnex as never,
      new DataDbRuntimeCacheService()
    );

    await expect(
      manager.dataPrismaForTable('tbl_new_in_tx', { useTransaction: true })
    ).resolves.toBe(metaFallbackDataPrisma);
    expect(txClient.tableMeta.findUnique).toHaveBeenCalledWith({
      where: { id: 'tbl_new_in_tx' },
      select: { base: { select: { spaceId: true } } },
    });
    expect(prismaService.tableMeta.findUnique).not.toHaveBeenCalled();
  });

  it('uses the root meta client by default even when transaction context exists', async () => {
    const txClient = {
      tableMeta: {
        findUnique: vi.fn().mockResolvedValue({ base: { spaceId: 'spc_in_tx' } }),
      },
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const prismaService = {
      ...withTxClient(txClient),
      tableMeta: {
        findUnique: vi.fn().mockResolvedValue({ base: { spaceId: 'spc_after_tx' } }),
      },
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const metaFallbackDataPrisma = {};
    const metaFallbackDataKnex = {};
    const manager = new DataDbClientManager(
      prismaService as never,
      metaFallbackDataPrisma as never,
      metaFallbackDataKnex as never,
      new DataDbRuntimeCacheService()
    );

    await expect(manager.dataPrismaForTable('tbl_after_tx')).resolves.toBe(metaFallbackDataPrisma);
    expect(txClient.tableMeta.findUnique).not.toHaveBeenCalled();
    expect(prismaService.tableMeta.findUnique).toHaveBeenCalledWith({
      where: { id: 'tbl_after_tx' },
      select: { base: { select: { spaceId: true } } },
    });
    expect(prismaService.spaceDataDbBinding.findUnique).toHaveBeenCalledWith({
      where: { spaceId: 'spc_after_tx' },
      include: { dataDbConnection: true },
    });
  });

  it('resolves BYODB connection details from a ready space binding', async () => {
    const dataUrl = 'postgresql://teable:secret@example.com:5432/teable_data';
    const internalSchema = 'teable_meta_test';
    const cls = {
      isActive: vi.fn().mockReturnValue(true),
      set: vi.fn(),
    };
    const prismaService = withTxClient({
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue({
          mode: 'byodb',
          state: 'ready',
          dataDbConnection: {
            id: 'dcnxxx',
            status: 'ready',
            internalSchema,
            displayHost: 'example.com',
            displayDatabase: 'teable_data',
            urlFingerprint: 'fp_xxx',
            encryptedUrl: encryptDataDbUrl(dataUrl),
          },
        }),
      },
    });
    const metaFallbackDataPrisma = {};
    const metaFallbackDataKnex = {};
    const manager = new DataDbClientManager(
      prismaService as never,
      metaFallbackDataPrisma as never,
      metaFallbackDataKnex as never,
      new DataDbRuntimeCacheService(),
      undefined,
      cls as never
    );

    await expect(manager.getDataDatabaseUrlForSpace('spcxxx')).resolves.toBe(
      `${dataUrl}?schema=${internalSchema}&options=-c+search_path%3D${internalSchema}`
    );
    await expect(manager.getDataDatabaseForSpace('spcxxx')).resolves.toMatchObject({
      cacheKey: 'dcnxxx',
      connectionId: 'dcnxxx',
      isMetaFallback: false,
      url: `${dataUrl}?schema=${internalSchema}&options=-c+search_path%3D${internalSchema}`,
    });
    expect(cls.set).toHaveBeenCalledWith('dataDb', {
      mode: 'byodb',
      spaceId: 'spcxxx',
      connectionId: 'dcnxxx',
      urlFingerprint: 'fp_xxx',
      displayHost: 'example.com',
      displayDatabase: 'teable_data',
      internalSchema,
    });
    await expect(manager.dataKnexForSpace('spcxxx')).resolves.not.toBe(metaFallbackDataKnex);
    await manager.onModuleDestroy();
  });

  it('resolves BYODB connection details when no CLS context is active', async () => {
    const dataUrl = 'postgresql://teable:secret@example.com:5432/teable_data';
    const internalSchema = 'teable_meta_test';
    const cls = {
      isActive: vi.fn().mockReturnValue(false),
      set: vi.fn(() => {
        throw new Error('No CLS context available');
      }),
    };
    const prismaService = withTxClient({
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue({
          mode: 'byodb',
          state: 'ready',
          dataDbConnection: {
            id: 'dcnxxx',
            status: 'ready',
            internalSchema,
            displayHost: 'example.com',
            displayDatabase: 'teable_data',
            urlFingerprint: 'fp_xxx',
            encryptedUrl: encryptDataDbUrl(dataUrl),
          },
        }),
      },
    });
    const manager = new DataDbClientManager(
      prismaService as never,
      {} as never,
      {} as never,
      new DataDbRuntimeCacheService(),
      undefined,
      cls as never
    );

    await expect(manager.getDataDatabaseUrlForSpace('spcxxx')).resolves.toBe(
      `${dataUrl}?schema=${internalSchema}&options=-c+search_path%3D${internalSchema}`
    );
    expect(cls.set).not.toHaveBeenCalled();
  });

  it('ensures the BYODB internal schema is migrated before returning a scoped URL', async () => {
    const dataUrl = 'postgresql://teable:secret@example.com:5432/teable_data';
    const internalSchema = 'teable_meta_test';
    const dataDbMigrationService = {
      ensureConnectionMigrated: vi.fn().mockResolvedValue([]),
    };
    const prismaService = withTxClient({
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue({
          mode: 'byodb',
          state: 'migrating',
          dataDbConnection: {
            id: 'dcnxxx',
            status: 'migrating',
            internalSchema,
            encryptedUrl: encryptDataDbUrl(dataUrl),
          },
        }),
      },
    });
    const manager = new DataDbClientManager(
      prismaService as never,
      {} as never,
      {} as never,
      new DataDbRuntimeCacheService(),
      dataDbMigrationService as never
    );

    await expect(manager.getDataDatabaseForSpace('spcxxx')).resolves.toMatchObject({
      cacheKey: 'dcnxxx',
      connectionId: 'dcnxxx',
      internalSchema,
      isMetaFallback: false,
    });
    expect(dataDbMigrationService.ensureConnectionMigrated).toHaveBeenCalledWith({
      connectionId: 'dcnxxx',
      internalSchema,
      url: dataUrl,
    });
  });
});
