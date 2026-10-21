import { once } from 'node:events';
import { Readable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import { FieldType } from '@teable/core';
import { SUPPORTEDTYPE } from '@teable/openapi';
import { Response } from 'node-fetch';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { safeFetch } from '../../../utils/ssrf-http';
import { CsvImporter, ExcelImporter, Importer } from './import.class';

vi.mock('../../../utils/ssrf-http', () => ({ safeFetch: vi.fn() }));

afterEach(() => vi.resetAllMocks());

describe('T7528 import source flow control', () => {
  it('backpressures an unread encoding stream and closes the upstream source', async () => {
    let produced = 0;
    const source = Readable.from(
      (async function* () {
        for (let index = 0; index < 10000; index++) {
          produced++;
          yield Buffer.from('a'.repeat(1023) + '\n');
        }
      })(),
      { objectMode: false }
    );
    vi.mocked(safeFetch).mockResolvedValue(
      new Response(source, { headers: [['content-type', 'text/csv']] })
    );
    const importer = new CsvImporter({
      url: 'https://example.com/rows.csv',
      type: SUPPORTEDTYPE.CSV,
    });
    const { stream } = await importer.getFile();
    try {
      await setImmediate();
      await setImmediate();
      expect(produced).toBeLessThan(1024);
    } finally {
      const closed = once(stream, 'close');
      stream.destroy();
      await closed;
    }
    expect(source.destroyed).toBe(true);
  });

  it('closes the downloaded body when its media type is rejected', async () => {
    const source = Readable.from(['unsupported file']);
    vi.mocked(safeFetch).mockResolvedValue(
      new Response(source, { headers: [['content-type', 'text/plain']] })
    );
    const importer = new CsvImporter({
      url: 'https://example.com/rows.txt',
      type: SUPPORTEDTYPE.CSV,
    });
    await expect(importer.getFile()).rejects.toMatchObject({ status: 400 });
    expect(source.destroyed).toBe(true);
  });

  it('keeps Excel type inference across rows beyond the preview without collecting them', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['Report'],
        [],
        ['Name', 'Value'],
        ...Array.from({ length: 600 }, (_, index) => [`Row ${index}`, index]),
        ['Last row', 'not a number'],
      ]),
      'Rows'
    );
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', bookSST: true });
    vi.mocked(safeFetch).mockResolvedValue(
      new Response(Readable.from([bytes]), {
        headers: [
          ['content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        ],
      })
    );
    const importer = new ExcelImporter({
      url: 'https://example.com/rows.xlsx',
      type: SUPPORTEDTYPE.EXCEL,
    });
    const result = await importer.genColumns();
    expect(result.worksheets.Rows.columns).toEqual([
      { name: 'Name', type: FieldType.SingleLineText },
      { name: 'Value', type: FieldType.SingleLineText },
    ]);
  });

  it('awaits bounded legacy Excel batches and preserves the final batch marker', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['Name', 'Value'],
        ...Array.from({ length: 1201 }, (_, index) => [`Row ${index}`, index]),
      ]),
      'Rows'
    );
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    vi.mocked(safeFetch).mockResolvedValue(
      new Response(Readable.from([bytes]), {
        headers: [
          ['content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        ],
      })
    );
    const importer = new ExcelImporter({
      url: 'https://example.com/rows.xlsx',
      type: SUPPORTEDTYPE.EXCEL,
    });
    let pending = false;
    let count = 0;
    let last = false;
    await importer.parse({ key: 'Rows', skipFirstNLines: 1 }, async (batch, isLast) => {
      expect(pending).toBe(false);
      pending = true;
      expect(batch.Rows.length).toBeLessThanOrEqual(Importer.MAX_CHUNK_LENGTH);
      expect(batch.Rows[0]).toEqual([`Row ${count}`, String(count)]);
      count += batch.Rows.length;
      last = Boolean(isLast);
      await setImmediate();
      pending = false;
    });
    expect(count).toBe(1201);
    expect(last).toBe(true);
  });
});
