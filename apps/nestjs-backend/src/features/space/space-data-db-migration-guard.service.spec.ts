import { HttpErrorCode } from '@teable/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpaceDataDbMigrationGuardService } from './space-data-db-migration-guard.service';

describe('SpaceDataDbMigrationGuardService', () => {
  const prismaService = {
    spaceDataDbMigrationJob: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    base: {
      findUnique: vi.fn(),
    },
    tableMeta: {
      findUnique: vi.fn(),
    },
  };

  beforeEach(() => {
    prismaService.spaceDataDbMigrationJob.findFirst.mockReset();
    prismaService.spaceDataDbMigrationJob.findMany.mockReset().mockResolvedValue([]);
    prismaService.base.findUnique.mockReset();
    prismaService.tableMeta.findUnique.mockReset();
  });

  it('allows writes when no active migration job exists for the space', async () => {
    prismaService.spaceDataDbMigrationJob.findFirst.mockResolvedValue(null);
    const service = new SpaceDataDbMigrationGuardService(prismaService as never);

    await expect(service.assertSpaceWritable('spcxxx')).resolves.toBeUndefined();

    expect(prismaService.spaceDataDbMigrationJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ spaceId: 'spcxxx' }),
      })
    );
  });

  it('rejects writes for a space that has an active migration job', async () => {
    prismaService.spaceDataDbMigrationJob.findFirst.mockResolvedValue({
      id: 'sdmjxxx',
      state: 'freezing_writes',
    });
    const service = new SpaceDataDbMigrationGuardService(prismaService as never);

    await expect(service.assertSpaceWritable('spcxxx')).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_MIGRATING',
        migrationJobId: 'sdmjxxx',
      }),
    });
  });

  it('rejects writes for a related space included in a grouped active migration job', async () => {
    prismaService.spaceDataDbMigrationJob.findFirst.mockResolvedValue(null);
    prismaService.spaceDataDbMigrationJob.findMany.mockResolvedValue([
      {
        id: 'sdmjgroup',
        state: 'copying',
        spaceId: 'spcprimary',
        inventory: {
          spaceIds: ['spcprimary', 'spcrelated'],
        },
      },
    ]);
    const service = new SpaceDataDbMigrationGuardService(prismaService as never);

    await expect(service.assertSpaceWritable('spcrelated')).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_MIGRATING',
        migrationJobId: 'sdmjgroup',
      }),
    });
  });

  it('resolves base and table ids to space ids before checking the freeze', async () => {
    prismaService.spaceDataDbMigrationJob.findFirst.mockResolvedValue(null);
    prismaService.base.findUnique.mockResolvedValue({ spaceId: 'spcxxx' });
    prismaService.tableMeta.findUnique.mockResolvedValue({ base: { spaceId: 'spcxxx' } });
    const service = new SpaceDataDbMigrationGuardService(prismaService as never);

    await service.assertBaseWritable('bsexxx');
    await service.assertTableWritable('tblxxx');

    expect(prismaService.base.findUnique).toHaveBeenCalledWith({
      where: { id: 'bsexxx' },
      select: { spaceId: true },
    });
    expect(prismaService.tableMeta.findUnique).toHaveBeenCalledWith({
      where: { id: 'tblxxx' },
      select: { base: { select: { spaceId: true } } },
    });
    expect(prismaService.spaceDataDbMigrationJob.findFirst).toHaveBeenCalledTimes(2);
  });

  it('uses the active transaction client when resolving migration state', async () => {
    const txClient = {
      spaceDataDbMigrationJob: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      base: {
        findUnique: vi.fn().mockResolvedValue({ spaceId: 'spctx' }),
      },
      tableMeta: {
        findUnique: vi.fn().mockResolvedValue({ base: { spaceId: 'spctx' } }),
      },
    };
    const rootPrisma = {
      ...prismaService,
      txClient: vi.fn().mockReturnValue(txClient),
    };
    const service = new SpaceDataDbMigrationGuardService(rootPrisma as never);

    await service.assertBaseWritable('bsetx');
    await service.assertTableWritable('tbltx');

    expect(txClient.base.findUnique).toHaveBeenCalledWith({
      where: { id: 'bsetx' },
      select: { spaceId: true },
    });
    expect(txClient.tableMeta.findUnique).toHaveBeenCalledWith({
      where: { id: 'tbltx' },
      select: { base: { select: { spaceId: true } } },
    });
    expect(txClient.spaceDataDbMigrationJob.findFirst).toHaveBeenCalledTimes(2);
    expect(prismaService.base.findUnique).not.toHaveBeenCalled();
    expect(prismaService.tableMeta.findUnique).not.toHaveBeenCalled();
  });
});
