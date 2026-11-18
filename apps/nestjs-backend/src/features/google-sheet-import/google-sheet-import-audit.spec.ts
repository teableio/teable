/* eslint-disable @typescript-eslint/no-explicit-any */
import { FieldKeyType } from '@teable/core';
import { importGoogleSheetIssueSchema } from '@teable/openapi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AirtableImportService } from '../airtable-import/airtable-import.service';
import { GoogleSheetApiClient } from './google-sheet-api.client';
import { GoogleSheetImportService } from './google-sheet-import.service';

const audit = {
  emitAtomic: vi.fn(async () => undefined),
  withOperation: vi.fn(async (_input: unknown, fn: () => Promise<unknown>) => fn()),
};
const newBase = { id: 'bseNew', name: 'Imported', spaceId: 'spc1' };
const baseService = {
  createBase: vi.fn(async () => newBase),
  deleteBase: vi.fn(async () => undefined),
  getBaseById: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Google Sheets import audit', () => {
  const createService = () => {
    const service = new GoogleSheetImportService(
      baseService as never,
      {} as never,
      {} as never,
      audit as never,
      undefined
    );
    vi.spyOn(service as any, 'createClient').mockReturnValue({});
    vi.spyOn(service as any, 'getSheetProperties').mockResolvedValue({
      title: 'Book',
      sheets: [{ sheetId: 1, title: 'Empty', gridProperties: { rowCount: 0, columnCount: 1 } }],
    });
    vi.spyOn(service as any, 'sampleColumns').mockResolvedValue({ columns: [], headerRow: 1 });
    return service;
  };

  it('imports a new base under base.import, and records the base and its cleanup', async () => {
    await expect(
      createService().importSpreadsheet({ spreadsheetId: 'sheet1', spaceId: 'spc1' } as never)
    ).rejects.toThrow('No importable data');

    expect(audit.withOperation).toHaveBeenCalledWith(
      { rootAction: 'base.import', resourceId: 'spc1' },
      expect.any(Function)
    );
    expect(audit.emitAtomic).toHaveBeenNthCalledWith(1, {
      action: 'base.create',
      resourceId: 'bseNew',
      params: { baseId: 'bseNew', spaceId: 'spc1', importSource: 'google-sheet' },
      payload: { base: newBase },
    });
    expect(baseService.deleteBase).toHaveBeenCalledWith('bseNew');
    expect(audit.emitAtomic).toHaveBeenNthCalledWith(2, {
      action: 'base.delete',
      resourceId: 'bseNew',
      params: {
        baseId: 'bseNew',
        spaceId: 'spc1',
        importSource: 'google-sheet',
        reason: 'import-failed',
      },
    });
  });

  it('imports into an existing base under table.import, creating no base', async () => {
    baseService.getBaseById.mockResolvedValueOnce({ id: 'bse1', name: 'CRM', spaceId: 'spc1' });

    await expect(
      createService().importSpreadsheet({ spreadsheetId: 'sheet1', baseId: 'bse1' } as never)
    ).rejects.toThrow();

    expect(audit.withOperation).toHaveBeenCalledWith(
      { rootAction: 'table.import', resourceId: 'bse1' },
      expect.any(Function)
    );
    expect(baseService.createBase).not.toHaveBeenCalled();
    expect(audit.emitAtomic).not.toHaveBeenCalled();
  });

  it('names the base it writes into the moment that base exists', async () => {
    const onBaseResolved = vi.fn();
    await expect(
      createService().importSpreadsheet(
        { spreadsheetId: 'sheet1', spaceId: 'spc1' } as never,
        undefined,
        undefined,
        onBaseResolved
      )
    ).rejects.toThrow('No importable data');
    expect(onBaseResolved).toHaveBeenCalledExactlyOnceWith('bseNew');

    baseService.getBaseById.mockResolvedValueOnce({ id: 'bse1', name: 'CRM', spaceId: 'spc1' });
    onBaseResolved.mockClear();
    await expect(
      createService().importSpreadsheet(
        { spreadsheetId: 'sheet1', baseId: 'bse1' } as never,
        undefined,
        undefined,
        onBaseResolved
      )
    ).rejects.toThrow();
    expect(onBaseResolved).toHaveBeenCalledExactlyOnceWith('bse1');
  });
});

describe('Airtable import audit', () => {
  const createService = () => {
    const service = new AirtableImportService(
      baseService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      audit as never,
      undefined
    );
    vi.spyOn(service as any, 'createClient').mockReturnValue({ getBaseSchema: async () => [] });
    // Stops the pipeline right after the base was created.
    vi.spyOn(service as any, 'resolveAiModelKey').mockRejectedValue(new Error('stop'));
    return service;
  };

  it('records the new base under base.import as soon as it exists', async () => {
    await expect(
      createService().importBase({
        airtableBaseId: 'appAir',
        spaceId: 'spc1',
        accessToken: 't',
      } as never)
    ).rejects.toThrow('stop');

    expect(audit.withOperation).toHaveBeenCalledWith(
      { rootAction: 'base.import', resourceId: 'spc1' },
      expect.any(Function)
    );
    expect(audit.emitAtomic).toHaveBeenCalledWith({
      action: 'base.create',
      resourceId: 'bseNew',
      params: {
        baseId: 'bseNew',
        spaceId: 'spc1',
        importSource: 'airtable',
        airtableBaseId: 'appAir',
      },
      payload: { base: newBase },
    });
  });

  it('names the base it writes into before anything after its creation can fail', async () => {
    const onProgress = vi.fn();
    const onBaseResolved = vi.fn();
    // Even the audit entry of the new base failing must not lose the base id.
    audit.emitAtomic.mockRejectedValueOnce(new Error('audit write failed'));

    await expect(
      createService().importBase(
        {
          airtableBaseId: 'appAir',
          spaceId: 'spc1',
          baseName: 'Imported',
          accessToken: 't',
        } as never,
        onProgress,
        onBaseResolved
      )
    ).rejects.toThrow();

    expect(onBaseResolved).toHaveBeenCalledExactlyOnceWith('bseNew');
    // No progress event follows the creation, so the id cannot travel on one.
    expect(onProgress.mock.calls.map(([event]) => event.phase)).toEqual([
      'fetching_schema',
      'creating_base',
    ]);
  });

  it('names an existing target base too', async () => {
    baseService.getBaseById.mockResolvedValueOnce({ id: 'bse1', name: 'CRM', spaceId: 'spc1' });
    const onBaseResolved = vi.fn();

    await expect(
      createService().importBase(
        { airtableBaseId: 'appAir', baseId: 'bse1', accessToken: 't' } as never,
        undefined,
        onBaseResolved
      )
    ).rejects.toThrow('stop');

    expect(onBaseResolved).toHaveBeenCalledExactlyOnceWith('bse1');
  });
});

describe('Google Sheets import data diagnostics', () => {
  const createImport = () => {
    const createRecords = vi.fn().mockResolvedValue({ records: [] });
    const getValues = vi.spyOn(GoogleSheetApiClient.prototype, 'getValues').mockReset();
    const tableService = {
      createTable: vi.fn().mockResolvedValue({
        id: 'tblImported',
        fields: [{ id: 'fldDate' }, { id: 'fldText' }, { id: 'fldNumber' }],
      }),
      deleteTable: vi.fn().mockResolvedValue(undefined),
    };
    const service = new GoogleSheetImportService(
      baseService as never,
      tableService as never,
      { createRecords } as never,
      audit as never,
      undefined
    );
    vi.spyOn(GoogleSheetApiClient.prototype, 'getSpreadsheetMeta').mockResolvedValue({
      properties: { title: 'Book' },
      sheets: [
        {
          properties: {
            sheetId: 1,
            title: 'Data',
            gridProperties: { rowCount: 2005, columnCount: 3 },
          },
        },
      ],
    });
    vi.spyOn(GoogleSheetApiClient.prototype, 'getGridSample').mockResolvedValue({
      sheets: [
        {
          data: [
            {
              rowData: [
                {},
                {},
                {
                  values: ['Date', 'Text', 'Number'].map((value) => ({
                    effectiveValue: { stringValue: value },
                    formattedValue: value,
                  })),
                },
                {
                  values: [
                    {
                      effectiveValue: { numberValue: 25569 },
                      effectiveFormat: { numberFormat: { type: 'DATE' } },
                    },
                    { effectiveValue: { stringValue: 'kept' } },
                    { effectiveValue: { numberValue: 12 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    return { service, createRecords, getValues, tableService };
  };
  const ro = { spreadsheetId: 'sheet1', spaceId: 'spc1', accessToken: 'test-token' };

  it('keeps rows with only bad dates, with original sparse grid row samples across chunks', async () => {
    const { service, createRecords, getValues } = createImport();
    getValues
      .mockResolvedValueOnce({ values: [[1700000000000], [], [25569.5, 'kept', 12]] })
      .mockResolvedValueOnce({ values: [[1700000000000], []] });
    const progress = vi.fn();

    const result = await service.importSpreadsheet(ro, progress);

    expect(createRecords.mock.calls).toEqual([
      [
        'tblImported',
        {
          fieldKeyType: FieldKeyType.Id,
          typecast: true,
          records: [
            {
              fields: {
                fldDate: '1970-01-01T12:00:00.000Z',
                fldText: 'kept',
                fldNumber: 12,
              },
            },
            { fields: {} },
          ],
        },
      ],
      ['tblImported', { fieldKeyType: FieldKeyType.Id, typecast: true, records: [{ fields: {} }] }],
    ]);
    expect(result.issues).toEqual([
      {
        code: 'valuesDropped',
        sheetName: 'Data',
        fieldName: 'Date',
        count: 2,
        rowNumbers: [4, 2004],
        reason: 'the cell value does not fit the inferred column type',
      },
    ]);
    expect(importGoogleSheetIssueSchema.parse(result.issues[0])).toEqual(result.issues[0]);
    expect(JSON.stringify(result.issues)).not.toContain('1700000000000');
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'table_records_done', importedRecords: 3, processedRows: 2002 })
    );
    expect(getValues).toHaveBeenNthCalledWith(1, 'sheet1', 'Data', 4, 2003, 3);
    expect(getValues).toHaveBeenNthCalledWith(2, 'sheet1', 'Data', 2004, 2005, 3);
  });

  it('caps samples at 100 per table across fields and chunks while keeping exact counts', async () => {
    const { service, getValues } = createImport();
    getValues
      .mockResolvedValueOnce({
        values: Array.from({ length: 60 }, () => [1700000000000, 'kept', 'private invalid number']),
      })
      .mockResolvedValueOnce({ values: [[1700000000000, 'kept', 'private invalid number']] });

    const { issues } = await service.importSpreadsheet(ro);

    expect(issues.map(({ count }) => count)).toEqual([61, 61]);
    expect(issues.flatMap(({ rowNumbers = [] }) => rowNumbers)).toHaveLength(100);
    for (const issue of issues) {
      expect(issue.rowNumbers).toEqual(Array.from({ length: 50 }, (_, index) => index + 4));
      expect(importGoogleSheetIssueSchema.parse(issue)).toEqual(issue);
    }
    expect(JSON.stringify(issues)).not.toContain('private invalid number');
    expect(
      importGoogleSheetIssueSchema.safeParse({ ...issues[0], rowNumbers: [0] }).success
    ).toBe(false);
    expect(
      importGoogleSheetIssueSchema.safeParse({ ...issues[0], rowNumbers: Array(101).fill(1) }).success
    ).toBe(false);
  });

  it.each(['permission denied', 'quota exceeded', 'connection failed', 'transaction failed'])(
    'propagates record-system failure %s without retries or row-data warnings',
    async (message) => {
      const { service, createRecords, getValues, tableService } = createImport();
      getValues.mockResolvedValueOnce({ values: [[25569, 'kept', 12]] });
      const failure = new Error(message);
      createRecords.mockRejectedValueOnce(failure);

      await expect(service.importSpreadsheet(ro)).rejects.toBe(failure);

      expect(createRecords).toHaveBeenCalledTimes(1);
      expect(getValues).toHaveBeenCalledTimes(1);
      expect(tableService.deleteTable).toHaveBeenCalledWith('bseNew', 'tblImported');
    }
  );

  it('propagates a Google source failure before attempting to create records', async () => {
    const { service, createRecords, getValues } = createImport();
    const failure = new Error('Google source quota exceeded');
    getValues.mockRejectedValueOnce(failure);

    await expect(service.importSpreadsheet(ro)).rejects.toBe(failure);

    expect(createRecords).not.toHaveBeenCalled();
    expect(getValues).toHaveBeenCalledTimes(1);
  });
});
