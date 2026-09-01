import { setSafeFetch } from '@teable/v2-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import { ExcelImportAdapter } from './ExcelImportAdapter';

const createXlsxBytes = (rows: unknown[][], origin?: string): Uint8Array => {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows, origin ? { origin } : undefined);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
};

describe('ExcelImportAdapter', () => {
  const adapter = new ExcelImportAdapter();

  describe('supports', () => {
    it('supports xlsx type', () => {
      expect(adapter.supports('xlsx')).toBe(true);
    });

    it('supports xls type', () => {
      expect(adapter.supports('xls')).toBe(true);
    });

    it('supports excel type', () => {
      expect(adapter.supports('excel')).toBe(true);
    });

    it('does not support unsupported types', () => {
      expect(adapter.supports('csv')).toBe(false);
      expect(adapter.supports('json')).toBe(false);
    });
  });

  describe('supportedTypes', () => {
    it('returns all supported types', () => {
      expect(adapter.supportedTypes).toEqual(['xlsx', 'xls', 'excel']);
    });
  });

  describe('parse', () => {
    it('returns error when no url, data, or stream provided', async () => {
      const source = {
        type: 'xlsx',
      };

      const result = await adapter.parse(source);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('import.excel.invalid_source');
      }
    });

    it('parses Uint8Array workbook bytes with headers and data rows', async () => {
      const result = await adapter.parse({
        type: 'excel',
        data: createXlsxBytes([
          ['Name', 'Age'],
          ['Alice', 30],
        ]),
      });

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      expect(parsed.headers).toEqual(['Name', 'Age']);
      expect(parsed.currentSheet).toBe('Sheet1');
      expect([...(parsed.rows ?? [])]).toEqual([
        ['Name', 'Age'],
        ['Alice', '30'],
      ]);
    });

    it('uses the real header row when a template starts below A1 with a title banner', async () => {
      const result = await adapter.parse({
        type: 'excel',
        data: createXlsxBytes(
          [
            ['Template title'],
            [],
            ['Legend'],
            [],
            ['Item', 'Lane', 'Origin'],
            [1, 'Shanghai-Hamburg', 'APAC'],
            [2, 'Ningbo-Antwerp', 'APAC'],
          ],
          'A2'
        ),
      });

      expect(result.isOk()).toBe(true);
      const parsed = result._unsafeUnwrap();
      expect(parsed.headers).toEqual(['Item', 'Lane', 'Origin']);
      expect([...(parsed.rows ?? [])]).toEqual([
        ['Item', 'Lane', 'Origin'],
        ['1', 'Shanghai-Hamburg', 'APAC'],
        ['2', 'Ningbo-Antwerp', 'APAC'],
      ]);
    });
  });

  describe('safeFetch registration', () => {
    afterEach(() => setSafeFetch(undefined));

    it('fetches URL sources through the registered safeFetch', async () => {
      const fetchFn = vi.fn().mockResolvedValue(new Response('not-an-xlsx', { status: 200 }));
      setSafeFetch(fetchFn);

      await adapter.parse({ type: 'xlsx', url: 'https://example.com/a.xlsx' });

      expect(fetchFn).toHaveBeenCalledWith('https://example.com/a.xlsx', undefined);
    });
  });

  describe('workbook reuse', () => {
    it('reports rowCount including the header row for the same buffer', async () => {
      const data = createXlsxBytes([
        ['Name', 'Age'],
        ['Alice', 30],
        ['Bob', 40],
      ]);

      const first = await adapter.parse({ type: 'excel', data });
      const second = await adapter.parse({ type: 'excel', data }, { sheetName: 'Sheet1' });

      expect(first.isOk()).toBe(true);
      expect(second.isOk()).toBe(true);
      expect(first._unsafeUnwrap().rowCount).toBe(3);
      expect(second._unsafeUnwrap().rowCount).toBe(3);
    });
  });
});
