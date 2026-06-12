import { HttpErrorCode } from '@teable/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomHttpException } from '../../custom.exception';
import { TableService } from './table.service';

describe('TableService write freeze', () => {
  const freezeError = new CustomHttpException(
    'Space data database migration is in progress',
    HttpErrorCode.CONFLICT,
    {
      errorCode: 'SPACE_DATA_DB_MIGRATING',
      migrationJobId: 'sdmjxxx',
    }
  );
  const prismaService = {
    txClient: vi.fn(),
  };
  const batchService = {
    saveRawOps: vi.fn(),
  };
  const migrationGuard = {
    assertBaseWritable: vi.fn(),
  };

  const service = () =>
    new TableService(
      { get: vi.fn().mockReturnValue('usrxxx') } as never,
      prismaService as never,
      {} as never,
      batchService as never,
      { driver: 'pg' } as never,
      {} as never,
      migrationGuard as never
    );

  beforeEach(() => {
    vi.clearAllMocks();
    migrationGuard.assertBaseWritable.mockRejectedValue(freezeError);
  });

  it('rejects table creation before locking or metadata writes when the base space is migrating', async () => {
    await expect(
      service().createTable('bsexxx', { name: 'Blocked table', fields: [] } as never)
    ).rejects.toBe(freezeError);

    expect(migrationGuard.assertBaseWritable).toHaveBeenCalledWith('bsexxx');
    expect(prismaService.txClient).not.toHaveBeenCalled();
    expect(batchService.saveRawOps).not.toHaveBeenCalled();
  });

  it('rejects table deletion before metadata writes when the base space is migrating', async () => {
    await expect(service().deleteTable('bsexxx', 'tblxxx', new Date())).rejects.toBe(freezeError);

    expect(migrationGuard.assertBaseWritable).toHaveBeenCalledWith('bsexxx');
    expect(prismaService.txClient).not.toHaveBeenCalled();
  });
});
