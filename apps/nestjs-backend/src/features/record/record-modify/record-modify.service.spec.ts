import { HttpErrorCode } from '@teable/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomHttpException } from '../../../custom.exception';
import { RecordModifyService } from './record-modify.service';

describe('RecordModifyService write freeze', () => {
  const freezeError = new CustomHttpException(
    'Space data database migration is in progress',
    HttpErrorCode.CONFLICT,
    {
      errorCode: 'SPACE_DATA_DB_MIGRATING',
      migrationJobId: 'sdmjxxx',
    }
  );
  const createService = {
    multipleCreateRecords: vi.fn(),
    createRecords: vi.fn(),
    createRecordsOnlySql: vi.fn(),
  };
  const updateService = {
    updateRecords: vi.fn(),
    simpleUpdateRecords: vi.fn(),
  };
  const deleteService = {
    deleteRecord: vi.fn(),
    deleteRecords: vi.fn(),
  };
  const duplicateService = {
    duplicateRecord: vi.fn(),
  };
  const tableDomainQueryService = {
    getTableDomainById: vi.fn(),
  };
  const migrationGuard = {
    assertTableRecordWritable: vi.fn(),
  };

  const service = () =>
    new RecordModifyService(
      createService as never,
      updateService as never,
      deleteService as never,
      duplicateService as never,
      tableDomainQueryService as never,
      migrationGuard as never
    );

  beforeEach(() => {
    vi.clearAllMocks();
    migrationGuard.assertTableRecordWritable.mockRejectedValue(freezeError);
  });

  it('rejects record create before any table metadata or write work when the space is migrating', async () => {
    await expect(service().multipleCreateRecords('tblxxx', { records: [] })).rejects.toBe(
      freezeError
    );

    expect(migrationGuard.assertTableRecordWritable).toHaveBeenCalledWith('tblxxx');
    expect(createService.multipleCreateRecords).not.toHaveBeenCalled();
    expect(tableDomainQueryService.getTableDomainById).not.toHaveBeenCalled();
  });

  it('rejects record update/delete/duplicate before delegating when the space is migrating', async () => {
    await expect(service().updateRecords('tblxxx', { records: [] })).rejects.toBe(freezeError);
    await expect(service().deleteRecords('tblxxx', ['recxxx'])).rejects.toBe(freezeError);
    await expect(
      service().duplicateRecord('tblxxx', 'recxxx', {
        viewId: 'viwxxx',
        anchorId: 'recanchor',
        position: 'after',
      })
    ).rejects.toBe(freezeError);

    expect(migrationGuard.assertTableRecordWritable).toHaveBeenCalledTimes(3);
    expect(updateService.updateRecords).not.toHaveBeenCalled();
    expect(deleteService.deleteRecords).not.toHaveBeenCalled();
    expect(duplicateService.duplicateRecord).not.toHaveBeenCalled();
  });

  it('allows non-migrating tables to continue through the normal write path', async () => {
    migrationGuard.assertTableRecordWritable.mockResolvedValue(undefined);
    createService.multipleCreateRecords.mockResolvedValue({ records: [] });

    await expect(service().multipleCreateRecords('tblother', { records: [] })).resolves.toEqual({
      records: [],
    });

    expect(migrationGuard.assertTableRecordWritable).toHaveBeenCalledWith('tblother');
    expect(createService.multipleCreateRecords).toHaveBeenCalled();
  });
});
