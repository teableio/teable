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
});
