import { describe, expect, it, vi } from 'vitest';
import { TableLifecycleCleanupService } from './table-lifecycle-cleanup.service';

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

    const service = new TableLifecycleCleanupService(
      prismaService as never,
      databaseRouter as never,
      {} as never,
      tableMutationCacheInvalidator as never,
      recordHistoryColdStorage as never
    );

    return {
      service,
      prismaClient,
      tableMutationCacheInvalidator,
      recordHistoryColdStorage,
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

  it('limits post-commit cleanupAfterNativePurge to cache invalidation and cold S3 prefixes', async () => {
    const { service, prismaClient, tableMutationCacheInvalidator, recordHistoryColdStorage } =
      createService();

    await service.cleanupAfterNativePurge('bse1', 'tbl1', {
      dbTableName: 'bse1.tbl1',
      fieldIds: ['fld1'],
    });

    expect(tableMutationCacheInvalidator.invalidateDroppedTable).toHaveBeenCalledWith('bse1.tbl1');
    expect(recordHistoryColdStorage.deleteTablePrefix).toHaveBeenCalledWith('tbl1');
    expect(prismaClient.field.findMany).not.toHaveBeenCalled();
  });
});
