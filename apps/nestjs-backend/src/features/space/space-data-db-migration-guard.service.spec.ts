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

  it('allows writes when the migration job table has not been deployed yet', async () => {
    const missingTableError = Object.assign(
      new Error(
        'The table `public.space_data_db_migration_job` does not exist in the current database.'
      ),
      { code: 'P2021' }
    );
    prismaService.spaceDataDbMigrationJob.findFirst.mockRejectedValue(missingTableError);
    const service = new SpaceDataDbMigrationGuardService(prismaService as never);

    await expect(service.assertSpaceWritable('spcxxx')).resolves.toBeUndefined();

    expect(prismaService.spaceDataDbMigrationJob.findMany).not.toHaveBeenCalled();
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

  it('does not treat test-only migration jobs as source write blockers', async () => {
    prismaService.spaceDataDbMigrationJob.findFirst.mockImplementation(async (args) => {
      expect(args).toMatchObject({
        where: {
          spaceId: 'spcxxx',
          switchOnCompletion: true,
        },
      });
      return null;
    });
    const service = new SpaceDataDbMigrationGuardService(prismaService as never);

    await expect(service.assertSpaceWritable('spcxxx')).resolves.toBeUndefined();
  });

  it('allows record writes during the online copy phase while schema writes stay blocked', async () => {
    prismaService.spaceDataDbMigrationJob.findFirst.mockImplementation(async (args) => {
      const states = args?.where?.state?.in ?? [];
      if (states.includes('copying')) {
        return {
          id: 'sdmjcopy',
          state: 'copying',
        };
      }
      return null;
    });
    const service = new SpaceDataDbMigrationGuardService(prismaService as never);

    await expect(service.assertSpaceSchemaWritable('spcxxx')).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_MIGRATING',
        migrationState: 'copying',
      }),
    });
    await expect(service.assertSpaceRecordWritable('spcxxx')).resolves.toBeUndefined();
  });

  it('blocks record writes during freezing even for test-only initial gates', async () => {
    prismaService.spaceDataDbMigrationJob.findFirst.mockImplementation(async (args) => {
      expect(args).toMatchObject({
        where: {
          spaceId: 'spcxxx',
          state: { in: ['freezing_writes', 'switching'] },
        },
      });
      expect(args.where).not.toHaveProperty('switchOnCompletion');
      return {
        id: 'sdmjtest',
        state: 'freezing_writes',
      };
    });
    const service = new SpaceDataDbMigrationGuardService(prismaService as never);

    await expect(service.assertSpaceRecordWritable('spcxxx')).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_MIGRATING',
        migrationJobId: 'sdmjtest',
      }),
    });
  });

  it('allows writes when the migration job table has not been migrated yet', async () => {
    prismaService.spaceDataDbMigrationJob.findFirst.mockRejectedValue(
      Object.assign(new Error('The table `public.space_data_db_migration_job` does not exist'), {
        code: 'P2021',
      })
    );
    const service = new SpaceDataDbMigrationGuardService(prismaService as never);

    await expect(service.assertSpaceWritable('spcxxx')).resolves.toBeUndefined();
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

  it('uses the active transaction client for id resolution but root client for migration jobs', async () => {
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
    rootPrisma.spaceDataDbMigrationJob.findFirst.mockResolvedValue(null);
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
    expect(rootPrisma.spaceDataDbMigrationJob.findFirst).toHaveBeenCalledTimes(2);
    expect(txClient.spaceDataDbMigrationJob.findFirst).not.toHaveBeenCalled();
    expect(prismaService.base.findUnique).not.toHaveBeenCalled();
    expect(prismaService.tableMeta.findUnique).not.toHaveBeenCalled();
  });

  it('does not poison the active transaction when the migration job table is missing', async () => {
    const missingTableError = Object.assign(
      new Error(
        'The table `public.space_data_db_migration_job` does not exist in the current database.'
      ),
      { code: 'P2021' }
    );
    const txClient = {
      spaceDataDbMigrationJob: {
        findFirst: vi.fn().mockRejectedValue(new Error('should not use transaction client')),
        findMany: vi.fn(),
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
    rootPrisma.spaceDataDbMigrationJob.findFirst.mockRejectedValue(missingTableError);
    const service = new SpaceDataDbMigrationGuardService(rootPrisma as never);

    await expect(service.assertTableWritable('tbltx')).resolves.toBeUndefined();

    expect(txClient.tableMeta.findUnique).toHaveBeenCalledWith({
      where: { id: 'tbltx' },
      select: { base: { select: { spaceId: true } } },
    });
    expect(rootPrisma.spaceDataDbMigrationJob.findFirst).toHaveBeenCalledTimes(1);
    expect(txClient.spaceDataDbMigrationJob.findFirst).not.toHaveBeenCalled();
  });
});
