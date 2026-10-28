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

  describe('constructor fetchFn', () => {
    it('keeps each adapter on its own url payload', async () => {
      const alphaFetch = vi.fn(async () => new Response('sku,qty\nA-1,7\n', { status: 200 }));
      const betaFetch = vi.fn(async () => new Response('sku,qty\nB-2,9\n', { status: 200 }));
      const alpha = new CsvImportAdapter(alphaFetch);
      const beta = new CsvImportAdapter(betaFetch);

      const alphaRows: unknown[][] = [];
      const alphaResult = await alpha.parse({ type: 'csv', url: 'https://example.com/alpha.csv' });
      if (alphaResult.isErr()) throw new Error(String(alphaResult.error));
      for await (const row of alphaResult.value.rowsAsync ?? []) alphaRows.push([...row]);

      const betaRows: unknown[][] = [];
      const betaResult = await beta.parse({ type: 'csv', url: 'https://example.com/beta.csv' });
      if (betaResult.isErr()) throw new Error(String(betaResult.error));
      for await (const row of betaResult.value.rowsAsync ?? []) betaRows.push([...row]);

      expect(alphaFetch).toHaveBeenCalledWith('https://example.com/alpha.csv');
      expect(betaFetch).toHaveBeenCalledWith('https://example.com/beta.csv');
      expect(alphaRows).toEqual([
        ['sku', 'qty'],
        ['A-1', '7'],
      ]);
      expect(betaRows).toEqual([
        ['sku', 'qty'],
        ['B-2', '9'],
      ]);
    });

    it('reads a bounded analyze preview through the constructor fetch', async () => {
      let pulls = 0;
      const endlessBody = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          controller.enqueue(new TextEncoder().encode('id,name\n1,Alice\n2,Bob\n3,Cara\n'));
        },
      });
      const fetchFn = vi.fn(async () => new Response(endlessBody, { status: 200 }));
      const adapterWithFetch = new CsvImportAdapter(fetchFn);

      const result = await adapterWithFetch.analyze(
        { type: 'csv', url: 'https://example.com/rows.csv' },
        {},
        1
      );

      expect(result.isOk()).toBe(true);
      if (result.isErr()) throw new Error(String(result.error));
      expect(result.value.sampleRows).toEqual([['1', 'Alice']]);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(pulls).toBeGreaterThan(0);
    });

    it('parses inline csv without calling the constructor fetch', async () => {
      const fetchFn = vi.fn(async (): Promise<Response> => {
        throw new Error('inline csv must not fetch');
      });
      const adapterWithFetch = new CsvImportAdapter(fetchFn);

      const result = await adapterWithFetch.parse({ type: 'csv', data: 'name,city\nAda,杭州\n' });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) throw new Error(String(result.error));
      const rows: unknown[][] = [];
      for await (const row of result.value.rowsAsync ?? []) rows.push([...row]);
      expect(rows).toEqual([
        ['name', 'city'],
        ['Ada', '杭州'],
      ]);
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });
});

describe('CsvImportAdapter bounded preview', () => {
  it('cancels the source once and stays under the sample cap', async () => {
    const sampleCapBytes = 1024 * 1024;
    const cancel = vi.fn();
    let bytesRead = 0;
    let chunkIndex = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunkIndex += 1;
        if (chunkIndex === 1) {
          const head = new TextEncoder().encode('name\n');
          const rowStart = new TextEncoder().encode('a'.repeat(500_000));
          bytesRead += head.byteLength + rowStart.byteLength;
          controller.enqueue(head);
          controller.enqueue(rowStart);
          return;
        }
        if (chunkIndex === 2) {
          const rowEnd = new TextEncoder().encode(`${'b'.repeat(100)}\n`);
          bytesRead += rowEnd.byteLength;
          controller.enqueue(rowEnd);
          return;
        }
        controller.enqueue(new TextEncoder().encode('never\n'));
      },
      cancel,
    });
    const fetchFn = vi.fn(async () => new Response(body, { status: 200 }));
    const adapterWithFetch = new CsvImportAdapter(fetchFn);

    const result = await adapterWithFetch.analyze(
      { type: 'csv', url: 'https://example.com/large.csv' },
      {},
      1
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw new Error(String(result.error));
    expect(result.value.sampleRows).toHaveLength(1);
    expect(String(result.value.sampleRows[0]?.[0])).toHaveLength(500_100);
    expect(bytesRead).toBeLessThanOrEqual(sampleCapBytes);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
