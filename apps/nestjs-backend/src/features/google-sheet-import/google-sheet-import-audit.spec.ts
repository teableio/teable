/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AirtableImportService } from '../airtable-import/airtable-import.service';
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
});

describe('Airtable import audit', () => {
  it('records the new base under base.import as soon as it exists', async () => {
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

    await expect(
      service.importBase({ airtableBaseId: 'appAir', spaceId: 'spc1', accessToken: 't' } as never)
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
});
