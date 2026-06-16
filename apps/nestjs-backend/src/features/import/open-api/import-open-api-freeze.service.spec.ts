import { HttpErrorCode } from '@teable/core';
import { SUPPORTEDTYPE } from '@teable/openapi';
import { vi } from 'vitest';
import { CustomHttpException } from '../../../custom.exception';
import { ImportOpenApiV2Service } from './import-open-api-v2.service';
import { ImportOpenApiService } from './import-open-api.service';

describe('Import open API write freeze', () => {
  const importCsvUrl = 'https://example.com/import.csv';
  const freezeError = new CustomHttpException(
    'Space data database migration is in progress',
    HttpErrorCode.CONFLICT,
    {
      errorCode: 'SPACE_DATA_DB_MIGRATING',
      migrationJobId: 'sdmjxxx',
    }
  );

  it('rejects v2 create-table imports before resolving the v2 container', async () => {
    const service = Object.create(ImportOpenApiV2Service.prototype) as {
      createTableFromCsvImport: ImportOpenApiV2Service['createTableFromCsvImport'];
      spaceDataDbMigrationGuard: { assertBaseWritable: ReturnType<typeof vi.fn> };
      v2ContainerService: { getContainerForBase: ReturnType<typeof vi.fn> };
      audit: { withOperation: ReturnType<typeof vi.fn> };
      cls: { get: ReturnType<typeof vi.fn> };
    };
    service.audit = {
      withOperation: vi.fn((_, fn: () => Promise<unknown>) => fn()),
    };
    service.cls = { get: vi.fn() };
    service.spaceDataDbMigrationGuard = {
      assertBaseWritable: vi.fn().mockRejectedValue(freezeError),
    };
    service.v2ContainerService = {
      getContainerForBase: vi.fn(),
    };

    await expect(
      service.createTableFromCsvImport('bseImport', {
        attachmentUrl: importCsvUrl,
        fileType: SUPPORTEDTYPE.CSV,
        worksheets: {},
      })
    ).rejects.toBe(freezeError);

    expect(service.spaceDataDbMigrationGuard.assertBaseWritable).toHaveBeenCalledWith('bseImport');
    expect(service.v2ContainerService.getContainerForBase).not.toHaveBeenCalled();
  });

  it('rejects v2 inplace imports before resolving the v2 container', async () => {
    const service = Object.create(ImportOpenApiV2Service.prototype) as {
      importRecords: ImportOpenApiV2Service['importRecords'];
      spaceDataDbMigrationGuard: { assertTableWritable: ReturnType<typeof vi.fn> };
      v2ContainerService: { getContainerForTable: ReturnType<typeof vi.fn> };
      audit: { withOperation: ReturnType<typeof vi.fn> };
      cls: { get: ReturnType<typeof vi.fn> };
    };
    service.audit = {
      withOperation: vi.fn((_, fn: () => Promise<unknown>) => fn()),
    };
    service.cls = { get: vi.fn() };
    service.spaceDataDbMigrationGuard = {
      assertTableWritable: vi.fn().mockRejectedValue(freezeError),
    };
    service.v2ContainerService = {
      getContainerForTable: vi.fn(),
    };

    await expect(
      service.importRecords('bseImport', 'tblImport', {
        attachmentUrl: importCsvUrl,
        fileType: SUPPORTEDTYPE.CSV,
        insertConfig: {
          sourceColumnMap: {},
          sourceWorkSheetKey: 'sheet1',
          excludeFirstRow: false,
        },
      })
    ).rejects.toBe(freezeError);

    expect(service.spaceDataDbMigrationGuard.assertTableWritable).toHaveBeenCalledWith('tblImport');
    expect(service.v2ContainerService.getContainerForTable).not.toHaveBeenCalled();
  });

  it('rejects queued create-table imports before checking queue capacity', async () => {
    const service = Object.create(ImportOpenApiService.prototype) as {
      createTableFromImport: ImportOpenApiService['createTableFromImport'];
      spaceDataDbMigrationGuard: { assertBaseWritable: ReturnType<typeof vi.fn> };
      importTableCsvChunkQueueProcessor: {
        queue: { getJobCountByTypes: ReturnType<typeof vi.fn> };
      };
    };
    service.spaceDataDbMigrationGuard = {
      assertBaseWritable: vi.fn().mockRejectedValue(freezeError),
    };
    service.importTableCsvChunkQueueProcessor = {
      queue: { getJobCountByTypes: vi.fn() },
    };

    await expect(
      service.createTableFromImport('bseImport', {
        attachmentUrl: importCsvUrl,
        fileType: SUPPORTEDTYPE.CSV,
        worksheets: {},
      })
    ).rejects.toBe(freezeError);

    expect(service.spaceDataDbMigrationGuard.assertBaseWritable).toHaveBeenCalledWith('bseImport');
    expect(
      service.importTableCsvChunkQueueProcessor.queue.getJobCountByTypes
    ).not.toHaveBeenCalled();
  });

  it('rejects queued inplace imports before checking queue capacity', async () => {
    const service = Object.create(ImportOpenApiService.prototype) as {
      inplaceImportTable: ImportOpenApiService['inplaceImportTable'];
      spaceDataDbMigrationGuard: { assertTableWritable: ReturnType<typeof vi.fn> };
      importTableCsvChunkQueueProcessor: {
        queue: { getJobCountByTypes: ReturnType<typeof vi.fn> };
      };
    };
    service.spaceDataDbMigrationGuard = {
      assertTableWritable: vi.fn().mockRejectedValue(freezeError),
    };
    service.importTableCsvChunkQueueProcessor = {
      queue: { getJobCountByTypes: vi.fn() },
    };

    await expect(
      service.inplaceImportTable('bseImport', 'tblImport', {
        attachmentUrl: importCsvUrl,
        fileType: SUPPORTEDTYPE.CSV,
        insertConfig: {
          sourceColumnMap: {},
          sourceWorkSheetKey: 'sheet1',
          excludeFirstRow: false,
        },
      })
    ).rejects.toBe(freezeError);

    expect(service.spaceDataDbMigrationGuard.assertTableWritable).toHaveBeenCalledWith('tblImport');
    expect(
      service.importTableCsvChunkQueueProcessor.queue.getJobCountByTypes
    ).not.toHaveBeenCalled();
  });
});
