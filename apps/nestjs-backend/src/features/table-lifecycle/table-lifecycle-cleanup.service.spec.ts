import { describe, expect, it, vi } from 'vitest';
import { TableLifecycleCleanupService } from './table-lifecycle-cleanup.service';
import { TablePurgeHookRegistry } from './table-purge.hook';

describe('TableLifecycleCleanupService', () => {
  const createService = () => {
    const prismaClient = {
      tableMeta: {
        findUnique: vi.fn(),
      },
      field: {
        findMany: vi.fn(),
      },
    };
    const prismaService = {
      txClient: vi.fn().mockReturnValue(prismaClient),
      base: { findUnique: vi.fn().mockResolvedValue({ spaceId: 'spc1' }) },
    };
    const databaseRouter = {
      isMetaFallbackForBase: vi.fn().mockResolvedValue(true),
    };
    const tableMutationCacheInvalidator = {
      invalidateDroppedTable: vi.fn().mockResolvedValue(undefined),
    };
    const recordHistoryColdStorage = {
      deleteTablePrefix: vi.fn().mockResolvedValue(undefined),
    };
    const tablePurgeHook = { afterPurge: vi.fn().mockResolvedValue(undefined) };
    const purgeHooks = new TablePurgeHookRegistry();
    purgeHooks.register(tablePurgeHook);

    const service = new TableLifecycleCleanupService(
      prismaService as never,
      databaseRouter as never,
      {} as never,
      tableMutationCacheInvalidator as never,
      recordHistoryColdStorage as never,
      purgeHooks
    );

    return {
      service,
      prismaService,
      prismaClient,
      tableMutationCacheInvalidator,
      recordHistoryColdStorage,
      tablePurgeHook,
    };
  };

  it('returns undefined from captureNativePurgeState when tableMeta is already absent', async () => {
    const { service, prismaClient } = createService();
    prismaClient.tableMeta.findUnique.mockResolvedValueOnce(null);
    prismaClient.field.findMany.mockResolvedValueOnce([]);

    await expect(service.captureNativePurgeState('tblMissing')).resolves.toBeUndefined();
  });

  it('captures dbTableName and fieldIds when tableMeta exists', async () => {
    const { service, prismaClient } = createService();
    prismaClient.tableMeta.findUnique.mockResolvedValueOnce({ dbTableName: 'bse1.tbl1' });
    prismaClient.field.findMany.mockResolvedValueOnce([{ id: 'fld1' }, { id: 'fld2' }]);

    await expect(service.captureNativePurgeState('tbl1')).resolves.toEqual({
      dbTableName: 'bse1.tbl1',
      fieldIds: ['fld1', 'fld2'],
    });
  });

  it('limits post-commit cleanupAfterNativePurge to cache invalidation and storage', async () => {
    const {
      service,
      prismaClient,
      tableMutationCacheInvalidator,
      recordHistoryColdStorage,
      tablePurgeHook,
    } = createService();

    await service.cleanupAfterNativePurge('bse1', 'tbl1', {
      dbTableName: 'bse1.tbl1',
      fieldIds: ['fld1'],
    });

    expect(tableMutationCacheInvalidator.invalidateDroppedTable).toHaveBeenCalledWith('bse1.tbl1');
    expect(recordHistoryColdStorage.deleteTablePrefix).toHaveBeenCalledWith('tbl1');
    // the base outlives a table purge and tells the space
    expect(tablePurgeHook.afterPurge).toHaveBeenCalledWith({ spaceId: 'spc1', tableIds: ['tbl1'] });
    expect(prismaClient.field.findMany).not.toHaveBeenCalled();
  });

  it('passes the space a base purge read, its base row being gone', async () => {
    const { service, prismaService, tablePurgeHook } = createService();

    await service.cleanupAfterPurge({ baseId: 'bse1', spaceId: 'spc9', tableIds: ['tbl1'] });

    expect(prismaService.base.findUnique).not.toHaveBeenCalled();
    expect(tablePurgeHook.afterPurge).toHaveBeenCalledWith({ spaceId: 'spc9', tableIds: ['tbl1'] });
  });

  it('does not fail a committed purge when the purge hook fails', async () => {
    const { service, recordHistoryColdStorage, tablePurgeHook } = createService();
    tablePurgeHook.afterPurge.mockRejectedValueOnce(new Error('queue down'));

    await expect(
      service.cleanupAfterPurge({ baseId: 'bse1', spaceId: 'spc1', tableIds: ['tbl1', 'tbl2'] })
    ).resolves.toBeUndefined();

    expect(recordHistoryColdStorage.deleteTablePrefix.mock.calls).toEqual([['tbl1'], ['tbl2']]);
  });
});
