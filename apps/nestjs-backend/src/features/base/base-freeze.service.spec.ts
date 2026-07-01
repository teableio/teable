import { HttpErrorCode } from '@teable/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomHttpException } from '../../custom.exception';
import { BaseService } from './base.service';

describe('BaseService write freeze', () => {
  const freezeError = new CustomHttpException(
    'Space data database migration is in progress',
    HttpErrorCode.CONFLICT,
    {
      errorCode: 'SPACE_DATA_DB_MIGRATING',
      migrationJobId: 'sdmjxxx',
    }
  );
  const prismaService = {
    base: {
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  const migrationGuard = {
    assertSpaceWritable: vi.fn(),
    assertBaseWritable: vi.fn(),
  };

  const service = () =>
    new BaseService(
      prismaService as never,
      {} as never,
      { get: vi.fn().mockReturnValue('usrxxx') } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      migrationGuard as never
    );

  beforeEach(() => {
    vi.clearAllMocks();
    migrationGuard.assertSpaceWritable.mockRejectedValue(freezeError);
    migrationGuard.assertBaseWritable.mockRejectedValue(freezeError);
  });

  it('rejects base creation before calculating order or creating metadata when the target space is migrating', async () => {
    await expect(
      service().createBase({ name: 'Blocked base', spaceId: 'spcxxx' } as never)
    ).rejects.toBe(freezeError);

    expect(migrationGuard.assertSpaceWritable).toHaveBeenCalledWith('spcxxx');
    expect(prismaService.base.create).not.toHaveBeenCalled();
  });

  it('rejects base update and delete before metadata writes when the base space is migrating', async () => {
    await expect(service().updateBase('bsexxx', { name: 'Blocked' })).rejects.toBe(freezeError);
    await expect(service().deleteBase('bsexxx')).rejects.toBe(freezeError);

    expect(migrationGuard.assertBaseWritable).toHaveBeenCalledTimes(2);
    expect(prismaService.base.update).not.toHaveBeenCalled();
  });
});
