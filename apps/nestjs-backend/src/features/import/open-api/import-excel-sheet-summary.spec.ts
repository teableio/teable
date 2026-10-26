import { SUPPORTEDTYPE } from '@teable/openapi';
import { domainError } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import { vi } from 'vitest';
import { ImportOpenApiV2Service } from './import-open-api-v2.service';

describe('V2 Excel import sheet summary', () => {
  it('keeps the localization of a failed sheet so the summary can be translated', async () => {
    const service = Object.create(ImportOpenApiV2Service.prototype) as Record<string, unknown> & {
      createTableFromExcelImport: ImportOpenApiV2Service['createTableFromExcelImport'];
    };
    const noColumns = domainError.validation({
      message: 'Excel sheet has no columns',
      code: 'import.excel.no_columns',
      localization: { i18nKey: 'httpErrors.import.excelSheetNoColumns' },
    });
    const importedTable = { id: () => ({ toString: () => 'tblData' }) };
    Object.assign(service, {
      audit: { withOperation: vi.fn((_, fn: () => Promise<unknown>) => fn()) },
      cls: { get: vi.fn() },
      v2ContainerService: { getContainerForBase: vi.fn().mockResolvedValue({ resolve: vi.fn() }) },
      v2ContextFactory: { createContext: vi.fn().mockResolvedValue({}) },
      eventEmitter: { emit: vi.fn() },
      logger: { error: vi.fn(), warn: vi.fn() },
      resolveUrl: vi.fn((url: string) => url),
      executeExcelSheet: vi
        .fn()
        .mockResolvedValueOnce(ok({ table: importedTable, totalImported: 1 }))
        .mockResolvedValueOnce(err(noColumns)),
      attachImportedTableToFolder: vi.fn().mockResolvedValue(undefined),
      mapImportedTable: vi.fn().mockReturnValue({ id: 'tblData' }),
    });
    const worksheet = { name: '', importData: true, useFirstRowAsHeader: true, columns: [] };

    const result = await service.createTableFromExcelImport(
      'bseImport',
      {
        attachmentUrl: '/import.xlsx',
        fileType: SUPPORTEDTYPE.EXCEL,
        worksheets: {
          data: { ...worksheet, name: 'Data' },
          empty: { ...worksheet, name: 'Empty' },
        },
      },
      undefined,
      undefined,
      {} as never
    );

    expect(result.sheets).toEqual([
      { name: 'Data', importedCount: 1, truncated: false },
      {
        name: 'Empty',
        importedCount: 0,
        truncated: false,
        error: 'Excel sheet has no columns',
        localization: { i18nKey: 'httpErrors.import.excelSheetNoColumns' },
      },
    ]);
  });
});
