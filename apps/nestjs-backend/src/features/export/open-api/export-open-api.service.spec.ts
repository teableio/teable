import { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { CellValueType, DbFieldType, FieldType } from '@teable/core';
import Papa from 'papaparse';
import { describe, expect, it, vi } from 'vitest';
import { ExportOpenApiService } from './export-open-api.service';

const tableId = 'tblCsvRegression';
const fields = ['Sequence', 'Text'].map((name, index) => ({
  id: `fldCsv${index}`,
  name,
  type: FieldType.SingleLineText,
  options: {},
  dbFieldName: `csv_${index}`,
  dbFieldType: DbFieldType.Text,
  cellValueType: CellValueType.String,
}));

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
/** Only the data-query boundary is synthetic; field conversion, CSV and Node streams are real. */
function fixture(useV2: boolean, totalRows: number, text = 'synthetic, "quoted"\r\n下一行🙂') {
  const getRecords = vi.fn(async (_id: string, query: { skip?: number; take?: number }) => {
    const skip = query.skip ?? 0;
    const take = Math.min(query.take ?? 1000, Math.max(0, totalRows - skip));
    return {
      records: Array.from({ length: take }, (_, offset) => ({
        id: `recCsv${skip + offset}`,
        fields: { Sequence: String(skip + offset), Text: text },
      })),
    };
  });
  const service = new ExportOpenApiService(
    { getFieldsByQuery: async () => fields } as never,
    { getRecords } as never,
    { tableMeta: { findUnique: async () => ({ name: 'Synthetic CSV' }) } } as never,
    { emitAtomic: vi.fn() } as never,
    { get: (key: string) => key === 'useV2' && useV2 } as never,
    { getRecords } as never,
    { getFields: async () => fields } as never
  );
  return { service, getRecords, text };
}

/** A real Writable which deliberately withholds its write callback until released. */
function stalledConsumer() {
  const firstWrite = deferred();
  let pending: (() => void) | undefined;
  let stalled = true;
  const chunks: Buffer[] = [];
  const sink = new Writable({
    highWaterMark: 1,
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      firstWrite.resolve();
      if (stalled) pending = callback;
      else callback();
    },
  });
  return {
    sink,
    firstWrite: firstWrite.promise,
    chunks,
    release() {
      stalled = false;
      const callback = pending;
      pending = undefined;
      callback?.();
    },
  };
}

// T8188 / Y3629: both query paths share the same CSV transport contract.
describe.each([false, true])('CSV export stream (useV2=%s)', (useV2) => {
  it('bounds page fetching while the consumer is stalled, then resumes without losing rows', async () => {
    // One page is much larger than the stream high-water mark, even on Node 22+.
    const { service, getRecords } = fixture(useV2, 8000, 'x'.repeat(1024));
    const prepared = await service.prepareCsvExport(tableId);
    const consumer = stalledConsumer();
    const consumed = finished(consumer.sink);
    prepared.stream.pipe(consumer.sink);
    const running = prepared.run();
    try {
      await consumer.firstWrite;
      // Allow enough turns for an unthrottled producer to encode every page.
      for (let turn = 0; turn < 150; turn++) await nextTurn();
      const pausedPages = getRecords.mock.calls.length;
      expect(pausedPages).toBeLessThanOrEqual(2);
      expect(prepared.stream.readableLength + consumer.sink.writableLength).toBeLessThan(
        3 * 1024 * 1024
      );
      consumer.release();
      await Promise.all([running, consumed]);
      const csv = Buffer.concat(consumer.chunks).toString('utf8');
      const parsed = Papa.parse<string[]>(csv);
      expect(parsed.errors).toEqual([]);
      expect(parsed.data).toHaveLength(8001);
      expect(parsed.data[1]).toEqual(['0', 'x'.repeat(1024)]);
      expect(parsed.data[8000]).toEqual(['7999', 'x'.repeat(1024)]);
    } finally {
      consumer.release();
      prepared.stream.destroy();
      consumer.sink.destroy();
      await Promise.allSettled([running, consumed]);
    }
  });

  it('stops fetching and settles the producer when a stalled stream is destroyed', async () => {
    const { service, getRecords } = fixture(useV2, 12000, 'x'.repeat(1024));
    const prepared = await service.prepareCsvExport(tableId);
    const consumer = stalledConsumer();
    prepared.stream.pipe(consumer.sink);
    const running = prepared.run();
    try {
      await consumer.firstWrite;
      await nextTurn();
      const pagesAtDisconnect = getRecords.mock.calls.length;
      expect(pagesAtDisconnect).toBeLessThanOrEqual(2);
      prepared.stream.destroy();
      consumer.release();
      await running;
      await nextTurn();
      // An already-issued query may finish, but cancellation must not launch another page.
      expect(getRecords.mock.calls.length).toBe(pagesAtDisconnect);
      expect(getRecords.mock.calls.length).toBeLessThan(12);
    } finally {
      consumer.release();
      prepared.stream.destroy();
      consumer.sink.destroy();
      await Promise.allSettled([running]);
    }
  });

  it('does not fetch another page when disconnected during an in-flight query', async () => {
    const { service, getRecords } = fixture(useV2, 5000);
    const enteredQuery = deferred();
    const releaseQuery = deferred();
    const originalQuery = getRecords.getMockImplementation()!;
    getRecords.mockImplementationOnce(async (id, query) => {
      enteredQuery.resolve();
      await releaseQuery.promise;
      return originalQuery(id, query);
    });
    const prepared = await service.prepareCsvExport(tableId);
    prepared.stream.resume();
    const running = prepared.run();
    try {
      await enteredQuery.promise;
      prepared.stream.destroy();
      releaseQuery.resolve();
      await running;
      await nextTurn();
      expect(getRecords).toHaveBeenCalledTimes(1);
    } finally {
      releaseQuery.resolve();
      prepared.stream.destroy();
      await Promise.allSettled([running]);
    }
  });

  it('preserves BOM, header, escaping, Unicode, order and every row across page boundaries', async () => {
    const { service, text } = fixture(useV2, 2507);
    const prepared = await service.prepareCsvExport(tableId);
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    const consumed = finished(sink);
    prepared.stream.pipe(sink);
    try {
      await Promise.all([prepared.run(), consumed]);
      const bytes = Buffer.concat(chunks);
      expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(prepared.fileName).toBe('Synthetic CSV');
      const parsed = Papa.parse<string[]>(bytes.toString('utf8').replace(/^\uFEFF/, ''));
      expect(parsed.errors).toEqual([]);
      expect(parsed.data[0]).toEqual(['Sequence', 'Text']);
      expect(parsed.data).toHaveLength(2508);
      for (let index = 0; index < 2507; index++) {
        expect(parsed.data[index + 1]).toEqual([String(index), text]);
      }
      expect(bytes.toString('utf8')).toContain('"synthetic, ""quoted""\r\n下一行🙂"');
    } finally {
      prepared.stream.destroy();
      sink.destroy();
      await Promise.allSettled([consumed]);
    }
  });

  it('lets a macrotask run before concurrent immediately-resolved exports finish', async () => {
    // No DB/network delay to accidentally provide fairness on behalf of the producer.
    const exports = await Promise.all(
      Array.from({ length: 4 }, async () => {
        const { service } = fixture(useV2, 12000, 'small');
        return service.prepareCsvExport(tableId);
      })
    );
    let completed = 0;
    const sinks = exports.map(() => new Writable({ write: (_chunk, _encoding, cb) => cb() }));
    const consumed = sinks.map((sink) => finished(sink));
    const running = exports.map((prepared, index) => {
      prepared.stream.pipe(sinks[index]);
      return prepared.run().then(() => {
        completed++;
      });
    });
    try {
      await nextTurn();
      // Deterministic scheduling assertion, not a CPU-speed or wall-clock threshold.
      expect(completed).toBeLessThan(exports.length);
      await Promise.all([...running, ...consumed]);
      expect(completed).toBe(exports.length);
    } finally {
      exports.forEach(({ stream }) => stream.destroy());
      sinks.forEach((sink) => sink.destroy());
      await Promise.allSettled([...running, ...consumed]);
    }
  });
});
