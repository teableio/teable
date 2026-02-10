import { describe, expect, it } from 'vitest';

import { CsvImportAdapter } from './CsvImportAdapter';

describe('CsvImportAdapter', () => {
  const adapter = new CsvImportAdapter();

  describe('supports', () => {
    it('supports csv type', () => {
      expect(adapter.supports('csv')).toBe(true);
    });

    it('supports tsv type', () => {
      expect(adapter.supports('tsv')).toBe(true);
    });

    it('supports txt type', () => {
      expect(adapter.supports('txt')).toBe(true);
    });

    it('does not support unsupported types', () => {
      expect(adapter.supports('xlsx')).toBe(false);
      expect(adapter.supports('json')).toBe(false);
    });
  });

  describe('supportedTypes', () => {
    it('returns all supported types', () => {
      expect(adapter.supportedTypes).toEqual(['csv', 'tsv', 'txt']);
    });
  });

  describe('parse', () => {
    it('parses CSV data string', async () => {
      const source = {
        type: 'csv',
        data: 'name,age\nAlice,30\nBob,25',
      };

      const result = await adapter.parse(source);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.headers).toEqual(['name', 'age']);
        expect(result.value.rows).toBeDefined();

        const rows: unknown[][] = [];
        for (const row of result.value.rows!) {
          rows.push([...row]);
        }
        expect(rows).toEqual([
          ['name', 'age'],
          ['Alice', '30'],
          ['Bob', '25'],
        ]);
      }
    });

    it('parses CSV with custom delimiter', async () => {
      const source = {
        type: 'csv',
        data: 'name;age\nAlice;30\nBob;25',
      };

      const result = await adapter.parse(source, { delimiter: ';' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.headers).toEqual(['name', 'age']);
        const rows: unknown[][] = [];
        for (const row of result.value.rows!) {
          rows.push([...row]);
        }
        expect(rows).toEqual([
          ['name', 'age'],
          ['Alice', '30'],
          ['Bob', '25'],
        ]);
      }
    });

    it('parses TSV data', async () => {
      const source = {
        type: 'tsv',
        data: 'name\tage\nAlice\t30',
      };

      const result = await adapter.parse(source, { delimiter: '\t' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.headers).toEqual(['name', 'age']);
      }
    });

    it('parses Uint8Array data', async () => {
      const data = new TextEncoder().encode('name,age\nAlice,30');
      const source = {
        type: 'csv',
        data,
      };

      const result = await adapter.parse(source);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.headers).toEqual(['name', 'age']);
      }
    });

    it('returns error when no url or data provided', async () => {
      const source = {
        type: 'csv',
      };

      const result = await adapter.parse(source);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('import.csv.invalid_source');
      }
    });

    it('handles empty CSV data', async () => {
      const source = {
        type: 'csv',
        data: '',
      };

      const result = await adapter.parse(source);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.headers).toEqual([]);
      }
    });

    it('handles CSV with only headers', async () => {
      const source = {
        type: 'csv',
        data: 'name,age',
      };

      const result = await adapter.parse(source);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.headers).toEqual(['name', 'age']);
        const rows: unknown[][] = [];
        for (const row of result.value.rows!) {
          rows.push([...row]);
        }
        expect(rows).toEqual([['name', 'age']]);
      }
    });
  });

  describe('analyze', () => {
    it('returns headers and sample rows', async () => {
      const source = {
        type: 'csv',
        data: 'name,age\nAlice,30\nBob,25\nCharlie,35',
      };

      const result = await adapter.analyze(source, {}, 2);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.headers).toEqual(['name', 'age']);
        expect(result.value.sampleRows).toEqual([
          ['Alice', '30'],
          ['Bob', '25'],
        ]);
      }
    });

    it('returns all rows if less than previewRows', async () => {
      const source = {
        type: 'csv',
        data: 'name,age\nAlice,30',
      };

      const result = await adapter.analyze(source, {}, 10);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.sampleRows).toEqual([['Alice', '30']]);
      }
    });
  });
});
