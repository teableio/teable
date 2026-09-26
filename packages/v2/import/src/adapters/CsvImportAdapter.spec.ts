import { setSafeFetch } from '@teable/v2-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    it('does not collect stream input and preserves positional cells on early return', async () => {
      let pulled = 0;
      let closed = false;
      async function* chunks() {
        try {
          yield ' name ,name,\n';
          for (let index = 0; index < 10_000; index++) {
            pulled++;
            yield ` Alice ${index} ,30, trailing \n`;
          }
        } finally {
          closed = true;
        }
      }
      const result = await adapter.parse({ type: 'csv', stream: chunks() });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(pulled).toBeLessThan(100);
      expect(result.value.headers).toEqual([' name ', 'name', '']);
      const rows = [];
      for await (const row of result.value.rowsAsync ?? result.value.rows ?? []) {
        rows.push(row);
        if (rows.length === 2) break;
      }
      expect(rows).toEqual([
        [' name ', 'name', ''],
        [' Alice 0 ', '30', ' trailing '],
      ]);
      expect(closed).toBe(true);
      expect(pulled).toBeLessThan(100);
    });

    it('analyzes URL input without downloading the rest and cancels its body', async () => {
      const cancel = vi.fn();
      let pulled = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulled === 0) {
            controller.enqueue(new TextEncoder().encode('name\tnote\r\n'));
          } else {
            controller.enqueue(
              new TextEncoder().encode(`Person ${pulled}\t"line 1\r\nline 2"\r\n`)
            );
          }
          pulled++;
          if (pulled === 10_000) controller.close();
        },
        cancel,
      });
      setSafeFetch(vi.fn().mockResolvedValue(new Response(body)));
      try {
        const result = await adapter.analyze(
          { type: 'tsv', url: 'https://example.com/synthetic.tsv' },
          { delimiter: '\t' },
          1
        );
        expect(result.isOk()).toBe(true);
        if (result.isErr()) return;
        expect(result.value.sampleRows).toEqual([['Person 1', 'line 1\r\nline 2']]);
        expect(pulled).toBeLessThan(100);
        expect(cancel).toHaveBeenCalledOnce();
        expect(body.locked).toBe(false);
      } finally {
        setSafeFetch(undefined);
      }
    });

    it('parses CSV data string', async () => {
      const source = {
        type: 'csv',
        data: 'name,age\nAlice,30\nBob,25',
      };

      const result = await adapter.parse(source);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.headers).toEqual(['name', 'age']);

        const rows: unknown[][] = [];
        for await (const row of result.value.rowsAsync!) {
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
        for await (const row of result.value.rowsAsync!) {
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
        for await (const row of result.value.rowsAsync!) {
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

  describe('safeFetch registration', () => {
    afterEach(() => setSafeFetch(undefined));

    it('fetches URL sources through the registered safeFetch', async () => {
      const fetchFn = vi.fn().mockResolvedValue(new Response('a,b\n1,2\n', { status: 200 }));
      setSafeFetch(fetchFn);

      const result = await adapter.parse({ type: 'csv', url: 'https://example.com/a.csv' });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      const rows = [];
      for await (const row of result.value.rowsAsync!) rows.push(row);
      expect(rows).toEqual([
        ['a', 'b'],
        ['1', '2'],
      ]);
    });

    it('keeps quoted newlines as a single CSV row', async () => {
      setSafeFetch(
        vi
          .fn()
          .mockResolvedValue(
            new Response('name,note\nAlice,"hello\nworld"\nBob,ok\n', { status: 200 })
          )
      );

      const result = await adapter.parse({ type: 'csv', url: 'https://example.com/quoted.csv' });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        return;
      }

      expect(result.value.headers).toEqual(['name', 'note']);
      const rows = [];
      for await (const row of result.value.rowsAsync!) rows.push(row);
      expect(rows).toEqual([
        ['name', 'note'],
        ['Alice', 'hello\nworld'],
        ['Bob', 'ok'],
      ]);
    });
  });
});
