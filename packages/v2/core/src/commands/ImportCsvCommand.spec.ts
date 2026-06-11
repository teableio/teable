import { describe, expect, it } from 'vitest';

import { ImportCsvCommand } from './ImportCsvCommand';

const baseId = `bse${'a'.repeat(16)}`;

describe('ImportCsvCommand', () => {
  it('creates from csvData input', () => {
    const result = ImportCsvCommand.create({
      baseId,
      csvData: 'Name,Age\nAlice,30',
      tableName: 'People',
    });

    expect(result.isOk()).toBe(true);
    const command = result._unsafeUnwrap();
    expect(command.csvSource.type).toBe('string');
    expect(command.tableName?.toString()).toBe('People');
    expect(command.batchSize).toBe(500);
  });

  it('creates from csvUrl input', () => {
    const result = ImportCsvCommand.create({
      baseId,
      csvUrl: 'https://example.com/data.csv',
      batchSize: 1000,
    });

    expect(result.isOk()).toBe(true);
    const command = result._unsafeUnwrap();
    expect(command.csvSource.type).toBe('url');
    expect(command.batchSize).toBe(1000);
  });

  it('validates batch size range', () => {
    const result = ImportCsvCommand.createFromBuffer({
      baseId,
      csvData: new Uint8Array([1, 2, 3]),
      batchSize: 0,
    });

    expect(result.isErr()).toBe(true);
  });

  it('rejects invalid csv url', () => {
    const result = ImportCsvCommand.createFromUrl({
      baseId,
      csvUrl: 'not-a-url',
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('csv.invalid_url');
  });

  it('creates from buffer and stream inputs', () => {
    const bufferResult = ImportCsvCommand.createFromBuffer({
      baseId,
      csvData: new Uint8Array([65, 44, 66]),
      tableName: 'Buffer Table',
    });

    expect(bufferResult.isOk()).toBe(true);
    expect(bufferResult._unsafeUnwrap().csvSource.type).toBe('buffer');
    expect(bufferResult._unsafeUnwrap().tableName?.toString()).toBe('Buffer Table');
    expect(bufferResult._unsafeUnwrap().batchSize).toBe(500);

    const streamResult = ImportCsvCommand.createFromStream({
      baseId,
      csvStream: (async function* () {
        yield 'Name,Age\nAlice,30';
      })(),
      tableName: 'Stream Table',
      batchSize: 300,
    });

    expect(streamResult.isOk()).toBe(true);
    expect(streamResult._unsafeUnwrap().csvSource.type).toBe('stream');
    expect(streamResult._unsafeUnwrap().tableName?.toString()).toBe('Stream Table');
    expect(streamResult._unsafeUnwrap().batchSize).toBe(300);
  });

  it.each([
    {
      name: 'string source with invalid tableName',
      run: () =>
        ImportCsvCommand.createFromString({
          baseId,
          csvData: 'Name\nAlice',
          tableName: '   ',
        }),
    },
    {
      name: 'buffer source with invalid tableName',
      run: () =>
        ImportCsvCommand.createFromBuffer({
          baseId,
          csvData: new Uint8Array([65]),
          tableName: '   ',
        }),
    },
    {
      name: 'stream source with invalid tableName',
      run: () =>
        ImportCsvCommand.createFromStream({
          baseId,
          csvStream: (async function* () {
            yield 'Name\nAlice';
          })(),
          tableName: '   ',
        }),
    },
    {
      name: 'url source with invalid tableName',
      run: () =>
        ImportCsvCommand.createFromUrl({
          baseId,
          csvUrl: 'https://example.com/data.csv',
          tableName: '   ',
        }),
    },
  ])('rejects $name', ({ run }) => {
    expect(run().isErr()).toBe(true);
  });

  it.each([
    () =>
      ImportCsvCommand.createFromString({
        baseId,
        csvData: 'Name\nAlice',
        batchSize: 5001,
      }),
    () =>
      ImportCsvCommand.createFromBuffer({
        baseId,
        csvData: new Uint8Array([65]),
        batchSize: 5001,
      }),
    () =>
      ImportCsvCommand.createFromStream({
        baseId,
        csvStream: (async function* () {
          yield 'Name\nAlice';
        })(),
        batchSize: 0,
      }),
    () =>
      ImportCsvCommand.createFromUrl({
        baseId,
        csvUrl: 'https://example.com/data.csv',
        batchSize: 0,
      }),
  ])('rejects out-of-range batch sizes for every constructor', (run) => {
    const result = run();

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('batchSize must be between 1 and 5000');
  });
});
