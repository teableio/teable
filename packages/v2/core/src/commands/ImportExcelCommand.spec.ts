import { describe, expect, it } from 'vitest';

import { ImportExcelCommand } from './ImportExcelCommand';

const baseId = `bse${'a'.repeat(16)}`;

describe('ImportExcelCommand', () => {
  it('creates from excel URL input', () => {
    const result = ImportExcelCommand.create({
      baseId,
      excelUrl: 'https://example.com/data.xlsx',
      tableName: 'Sheet1',
      sheetName: 'Sheet1',
      columns: [
        { name: 'Display Name', sourceColumnIndex: 0, type: 'singleLineText' },
        { name: 'Years', sourceColumnIndex: 1, type: 'number' },
      ],
    });

    expect(result.isOk()).toBe(true);
    const command = result._unsafeUnwrap();
    expect(command.source.type).toBe('excel');
    expect(command.source.url).toBe('https://example.com/data.xlsx');
    expect(command.tableName?.toString()).toBe('Sheet1');
    expect(command.sheetName).toBe('Sheet1');
    expect(command.importData).toBe(true);
    expect(command.columns).toEqual([
      { name: 'Display Name', sourceColumnIndex: 0, type: 'singleLineText' },
      { name: 'Years', sourceColumnIndex: 1, type: 'number' },
    ]);
  });

  it('preserves the no-header import option', () => {
    const result = ImportExcelCommand.createFromUrl({
      baseId,
      excelUrl: 'https://example.com/data.xlsx',
      useFirstRowAsHeader: false,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().useFirstRowAsHeader).toBe(false);
  });

  it('creates from buffer input', () => {
    const result = ImportExcelCommand.createFromBuffer({
      baseId,
      excelData: new Uint8Array([1, 2, 3]),
      tableName: 'Buffer Table',
      importData: false,
      fileType: 'xlsx',
      sheetName: 'Data',
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().source.type).toBe('xlsx');
    expect(result._unsafeUnwrap().tableName?.toString()).toBe('Buffer Table');
    expect(result._unsafeUnwrap().importData).toBe(false);
    expect(result._unsafeUnwrap().sheetName).toBe('Data');
  });

  it('rejects invalid excel url', () => {
    const result = ImportExcelCommand.createFromUrl({
      baseId,
      excelUrl: 'not-a-url',
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('import.excel.invalid_url');
  });

  it('rejects out-of-range batch sizes', () => {
    const result = ImportExcelCommand.createFromBuffer({
      baseId,
      excelData: new Uint8Array([1]),
      batchSize: 0,
    });

    expect(result.isErr()).toBe(true);
  });

  it('copies truncateOnRowLimit through withOnProgress', () => {
    const command = ImportExcelCommand.createFromBuffer({
      baseId,
      excelData: new Uint8Array([1, 2, 3]),
    })
      ._unsafeUnwrap()
      .withTruncateOnRowLimit(true)
      .withOnProgress(() => undefined);

    expect(command.truncateOnRowLimit).toBe(true);
  });
});
