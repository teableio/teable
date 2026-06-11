import { describe, expect, it } from 'vitest';

import { ImportRecordsCommand } from './ImportRecordsCommand';

const tableId = `tbl${'a'.repeat(16)}`;
const sourceColumnMap = {
  Name: 0,
  Age: 1,
};

const streamSource = async function* () {
  yield 'Name,Age\nAlice,30';
};

describe('ImportRecordsCommand', () => {
  it.each(['csv', 'tsv', 'txt', 'xlsx', 'xls', 'excel'])(
    'defaults skipFirstNLines to 1 for %s sources',
    (type) => {
      const result = ImportRecordsCommand.create({
        tableId,
        source: {
          type,
          data: 'Name,Age\nAlice,30',
        },
        sourceColumnMap,
      });

      expect(result.isOk()).toBe(true);
      const command = result._unsafeUnwrap();
      expect(command.source.type).toBe(type);
      expect(command.options.batchSize).toBe(500);
      expect(command.options.skipFirstNLines).toBe(1);
      expect(command.options.typecast).toBe(true);
    }
  );

  it('defaults skipFirstNLines to 0 for unsupported source types', () => {
    const result = ImportRecordsCommand.create({
      tableId,
      source: {
        type: 'json',
        data: '{}',
      },
      sourceColumnMap,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().options.skipFirstNLines).toBe(0);
  });

  it('supports explicit options for url and stream sources', () => {
    const urlResult = ImportRecordsCommand.create({
      tableId,
      source: {
        type: 'csv',
        url: 'https://example.com/data.csv',
      },
      sourceColumnMap,
      options: {
        batchSize: 1000,
        maxRowCount: 10,
        skipFirstNLines: 3,
        sheetName: 'Sheet 1',
        typecast: false,
        delimiter: ';',
      },
    });

    expect(urlResult.isOk()).toBe(true);
    expect(urlResult._unsafeUnwrap().source.url).toBe('https://example.com/data.csv');
    expect(urlResult._unsafeUnwrap().options).toMatchObject({
      batchSize: 1000,
      maxRowCount: 10,
      skipFirstNLines: 3,
      sheetName: 'Sheet 1',
      typecast: false,
      delimiter: ';',
    });

    const streamResult = ImportRecordsCommand.create({
      tableId,
      source: {
        type: 'txt',
        stream: streamSource(),
      },
      sourceColumnMap,
    });

    expect(streamResult.isOk()).toBe(true);
    expect(streamResult._unsafeUnwrap().source.stream).toBeDefined();
    expect(streamResult._unsafeUnwrap().options.skipFirstNLines).toBe(1);
  });

  it('creates from url input', () => {
    const result = ImportRecordsCommand.createFromUrl({
      tableId,
      url: 'https://example.com/import.csv',
      fileType: 'csv',
      sourceColumnMap,
      options: {
        batchSize: 250,
      },
    });

    expect(result.isOk()).toBe(true);
    const command = result._unsafeUnwrap();
    expect(command.source.type).toBe('csv');
    expect(command.source.url).toBe('https://example.com/import.csv');
    expect(command.options.batchSize).toBe(250);
  });

  it('rejects invalid input', () => {
    const invalidTableId = ImportRecordsCommand.create({
      tableId: 'not-a-table-id',
      source: {
        type: 'csv',
        data: 'Name\nAlice',
      },
      sourceColumnMap,
    });
    expect(invalidTableId.isErr()).toBe(true);

    const missingType = ImportRecordsCommand.create({
      tableId,
      source: {
        type: '',
        data: 'Name\nAlice',
      },
      sourceColumnMap,
    });
    expect(missingType.isErr()).toBe(true);
    expect(missingType._unsafeUnwrapErr().code).toBe('import.source_type_required');

    const missingPayload = ImportRecordsCommand.create({
      tableId,
      source: {
        type: 'csv',
      },
      sourceColumnMap,
    });
    expect(missingPayload.isErr()).toBe(true);
    expect(missingPayload._unsafeUnwrapErr().code).toBe('import.source_required');
  });

  it.each([
    {
      name: 'batchSize below range',
      options: { batchSize: 0 },
      expectedCode: 'import.invalid_batch_size',
    },
    {
      name: 'batchSize above range',
      options: { batchSize: 5001 },
      expectedCode: 'import.invalid_batch_size',
    },
    {
      name: 'negative maxRowCount',
      options: { maxRowCount: -1 },
      expectedCode: 'import.invalid_max_row_count',
    },
  ])('rejects $name', ({ options, expectedCode }) => {
    const result = ImportRecordsCommand.create({
      tableId,
      source: {
        type: 'csv',
        data: 'Name\nAlice',
      },
      sourceColumnMap,
      options,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(expectedCode);
  });
});
