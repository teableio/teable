import { Readable, Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { setImmediate as nextTurn } from 'node:timers/promises';
import archiver from 'archiver';
import Papa from 'papaparse';
import * as unzipper from 'unzipper';
import { describe, expect, it } from 'vitest';
import { appendBaseExportEntry, createBaseExportCsvStream } from './base-export-stream';
import { EXPORT_ZIP_OPTIONS } from './export-archive-guard';

const BYTE_BUDGET = 64 * 1024;

const promiseWithResolvers = Promise as unknown as {
  withResolvers<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
};

function controlledSink() {
  const firstWrite = promiseWithResolvers.withResolvers<void>();
  const chunks: Buffer[] = [];
  let pending: (() => void) | undefined;
  let stalled = true;
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
    chunks,
    firstWrite: firstWrite.promise,
    release() {
      stalled = false;
      const callback = pending;
      pending = undefined;
      callback?.();
    },
  };
}

async function collect(stream: Readable) {
  const chunks: Buffer[] = [];
  // Observe actual pushed byte chunks; async iteration may coalesce adjacent chunks.
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  await finished(stream);
  return chunks;
}

describe('createBaseExportCsvStream', () => {
  it('escapes physical headers and preserves ordered raw values, JSON strings and CSV casts', async () => {
    const headers = ['physical,b', 'physical"a', 'line\nname', 'Unicode🙂', 'date', 'bigint'];
    const row = [
      'a,"b"\nnext',
      null,
      '{"ids":["rec1","rec2"]}',
      '中文🙂',
      new Date('2024-01-01T00:00:00Z'),
      12345678901234567890n,
    ];
    async function* rows() {
      yield Object.freeze(row);
      yield ['', undefined, 'null', 'plain', null, null];
    }
    const chunks = await collect(createBaseExportCsvStream(Object.freeze(headers), rows()));
    const csv = Buffer.concat(chunks).toString('utf8');
    expect(csv.startsWith('\uFEFF')).toBe(false);
    expect(csv.endsWith('\n')).toBe(true);
    const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: true });
    expect(parsed.errors).toEqual([]);
    expect(parsed.data).toEqual([
      headers,
      [
        'a,"b"\nnext',
        '',
        '{"ids":["rec1","rec2"]}',
        '中文🙂',
        '1704067200000',
        '12345678901234567890',
      ],
      ['', '', 'null', 'plain', '', ''],
    ]);
    expect(csv).toContain('"physical,b","physical""a","line\nname",Unicode🙂,date,bigint\n');
  });

  it('writes a quoted header for an empty table', async () => {
    async function* rows(): AsyncGenerator<readonly unknown[]> {
      yield* [];
    }
    const chunks = await collect(createBaseExportCsvStream(['a,b', 'c"d'], rows()));
    expect(Buffer.concat(chunks).toString()).toBe('"a,b","c""d"\n');
  });

  it('bounds UTF-8 chunks without breaking surrogate pairs across a very wide row', async () => {
    const value = `${'界🙂,"\n'.repeat(100000)}tail`;
    async function* rows() {
      yield [value, 'last'];
    }
    const chunks = await collect(createBaseExportCsvStream(['wide', 'end'], rows()));
    expect(chunks.length).toBeGreaterThan(20);
    for (const chunk of chunks) {
      expect(chunk.byteLength).toBeLessThanOrEqual(BYTE_BUDGET);
      expect(chunk.toString('utf8')).not.toContain('\ufffd');
    }
    expect(
      Papa.parse<string[]>(Buffer.concat(chunks).toString(), { skipEmptyLines: true }).data
    ).toEqual([
      ['wide', 'end'],
      [value, 'last'],
    ]);
  });

  it('does not read a table ahead while its byte sink is stalled', async () => {
    let advanced = 0;
    let closed = false;
    async function* rows() {
      try {
        for (let index = 0; index < 30; index++) {
          advanced++;
          yield [index, 'x'.repeat(256 * 1024)];
        }
      } finally {
        closed = true;
      }
    }
    const source = createBaseExportCsvStream(['id', 'value'], rows());
    const consumer = controlledSink();
    const consumed = finished(consumer.sink);
    source.pipe(consumer.sink);
    try {
      await consumer.firstWrite;
      for (let turn = 0; turn < 80; turn++) await nextTurn();
      const pausedRows = advanced;
      expect(source.readableObjectMode).toBe(false);
      expect(source.readableHighWaterMark).toBe(BYTE_BUDGET);
      expect(pausedRows).toBeLessThanOrEqual(1);
      expect(source.readableLength).toBeLessThanOrEqual(2 * BYTE_BUDGET);
      for (let turn = 0; turn < 20; turn++) await nextTurn();
      expect(advanced).toBe(pausedRows);
      consumer.release();
      await consumed;
      expect(advanced).toBe(30);
      expect(closed).toBe(true);
    } finally {
      consumer.release();
      source.destroy();
      consumer.sink.destroy();
      await Promise.allSettled([consumed]);
    }
  });

  it('lets timers run during wide-row conversion even with a fast sink', async () => {
    let advanced = 0;
    let timerAtRow: number | undefined;
    const timer = setTimeout(() => {
      timerAtRow = advanced;
    }, 0);
    async function* rows() {
      for (let index = 0; index < 80; index++) {
        advanced++;
        yield [index, '🙂,"'.repeat(32000)];
      }
    }
    const source = createBaseExportCsvStream(['id', 'wide'], rows());
    const sink = new Writable({ write: (_chunk, _encoding, callback) => callback() });
    const consumed = finished(sink);
    source.pipe(sink);
    try {
      await consumed;
      expect(timerAtRow).toBeDefined();
      expect(timerAtRow).toBeLessThan(80);
    } finally {
      clearTimeout(timer);
      source.destroy();
      sink.destroy();
    }
  });

  it('aborts a stalled reader and closes its row iterator without advancing it again', async () => {
    const abort = new AbortController();
    let advanced = 0;
    let closed = false;
    async function* rows() {
      try {
        while (true) {
          advanced++;
          yield ['界🙂'.repeat(100000)];
        }
      } finally {
        closed = true;
      }
    }
    const source = createBaseExportCsvStream(['value'], rows(), abort.signal);
    const ended = finished(source).then(
      () => undefined,
      (error: Error) => error
    );
    const consumer = controlledSink();
    source.pipe(consumer.sink);
    try {
      await consumer.firstWrite;
      for (let turn = 0; turn < 10; turn++) await nextTurn();
      const beforeAbort = advanced;
      const reason = new Error('subscriber cancelled');
      abort.abort(reason);
      expect(await ended).toBe(reason);
      expect(closed).toBe(true);
      for (let turn = 0; turn < 10; turn++) await nextTurn();
      expect(advanced).toBe(beforeAbort);
    } finally {
      consumer.release();
      source.destroy();
      consumer.sink.destroy();
    }
  });

  it('waits for an in-flight next and async iterator cleanup before closing on cancellation', async () => {
    const entered = promiseWithResolvers.withResolvers<void>();
    const query = promiseWithResolvers.withResolvers<void>();
    const cleaning = promiseWithResolvers.withResolvers<void>();
    const cleanup = promiseWithResolvers.withResolvers<void>();
    let calls = 0;
    const rows: AsyncIterable<readonly unknown[]> = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            calls++;
            entered.resolve();
            await query.promise;
            return { done: false as const, value: ['late row'] };
          },
          async return() {
            cleaning.resolve();
            await cleanup.promise;
            return { done: true as const, value: undefined };
          },
        };
      },
    };
    const source = createBaseExportCsvStream(['value'], rows);
    let settled = false;
    const ended = finished(source).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    source.resume();
    try {
      await entered.promise;
      source.destroy(new Error('cancel pending query'));
      query.resolve();
      await cleaning.promise;
      await nextTurn();
      expect(settled).toBe(false);
      expect(calls).toBe(1);
      cleanup.resolve();
      await ended;
      expect(calls).toBe(1);
    } finally {
      query.resolve();
      cleanup.resolve();
      source.destroy();
      await ended;
    }
  });
});

describe('appendBaseExportEntry', () => {
  it('finishes entries before finalize and preserves a real ZIP archive', async () => {
    const archive = archiver('zip', { zlib: { level: 0 } });
    const output = controlledSink();
    output.release();
    archive.pipe(output.sink);
    const consumed = finished(output.sink);
    await appendBaseExportEntry(archive, Readable.from(['first']), 'one.txt');
    await appendBaseExportEntry(archive, Readable.from(['second']), 'two.txt');
    await archive.finalize();
    await consumed;
    const zip = await unzipper.Open.buffer(Buffer.concat(output.chunks));
    expect(zip.files.map((file) => file.path)).toEqual(['one.txt', 'two.txt']);
    expect((await zip.files[0]!.buffer()).toString()).toBe('first');
    expect((await zip.files[1]!.buffer()).toString()).toBe('second');
  });

  it('keeps one source open and bounds row reads when the real archive sink stalls', async () => {
    const archive = archiver('zip', { ...EXPORT_ZIP_OPTIONS, zlib: { level: 0 } });
    const output = controlledSink();
    archive.pipe(output.sink);
    const consumed = finished(output.sink);
    let advanced = 0;
    let nextOpened = false;
    async function* rows() {
      for (let index = 0; index < 24; index++) {
        advanced++;
        yield [index, 'x'.repeat(256 * 1024)];
      }
    }
    const source = createBaseExportCsvStream(['id', 'value'], rows());
    const running = (async () => {
      await appendBaseExportEntry(archive, source, 'table.csv');
      nextOpened = true;
      await appendBaseExportEntry(archive, Readable.from(['attachment']), 'attachment.txt');
      await archive.finalize();
    })();
    const outcome = running.then(
      () => undefined,
      (error: Error) => error
    );
    try {
      await output.firstWrite;
      for (let turn = 0; turn < 80; turn++) await nextTurn();
      const pausedRows = advanced;
      expect(pausedRows).toBeLessThanOrEqual(4);
      expect(nextOpened).toBe(false);
      for (let turn = 0; turn < 20; turn++) await nextTurn();
      expect(advanced).toBe(pausedRows);
      output.release();
      expect(await outcome).toBeUndefined();
      await consumed;
      expect(nextOpened).toBe(true);
      expect(advanced).toBe(24);
    } finally {
      output.release();
      archive.abort();
      source.destroy();
      output.sink.destroy();
      await Promise.allSettled([outcome, consumed]);
    }
  });

  it.each(['source error', 'archive error', 'abort', 'early close'])(
    'releases a pending append on %s without unhandled error promises',
    async (failure) => {
      const archive = archiver('zip');
      const output = controlledSink();
      output.release();
      archive.pipe(output.sink);
      const abort = new AbortController();
      const source = new Readable({ read() {} });
      const reason = new Error(failure);
      const running = appendBaseExportEntry(archive, source, 'pending.csv', abort.signal);
      const rejected = expect(running).rejects.toThrow(
        failure === 'early close' ? 'closed before it finished' : failure
      );
      if (failure === 'source error') source.destroy(reason);
      if (failure === 'archive error') archive.emit('error', reason);
      if (failure === 'abort') abort.abort(reason);
      if (failure === 'early close') source.destroy();
      try {
        await rejected;
        expect(source.destroyed).toBe(true);
        expect(source.closed).toBe(true);
        await nextTurn();
      } finally {
        archive.abort();
        source.destroy();
        output.sink.destroy();
      }
    }
  );

  it('handles synchronous append rejection and destroys the source before rejecting', async () => {
    const archive = archiver('zip');
    // A real archive rejects append synchronously after finalization by emitting QUEUECLOSED.
    archive.resume();
    await archive.finalize();
    const source = Readable.from(['never appended']);
    await expect(appendBaseExportEntry(archive, source, 'late.txt')).rejects.toThrow();
    expect(source.closed).toBe(true);
    await nextTurn();
  });

  it('does not append or consume a source when already cancelled', async () => {
    const archive = archiver('zip');
    const abort = new AbortController();
    abort.abort(new Error('already cancelled'));
    let advanced = false;
    async function* rows() {
      advanced = true;
      yield ['never'];
    }
    const source = createBaseExportCsvStream(['value'], rows());
    await expect(
      appendBaseExportEntry(archive, source, 'cancelled.csv', abort.signal)
    ).rejects.toThrow('already cancelled');
    expect(advanced).toBe(false);
    expect(archive.pointer()).toBe(0);
    archive.abort();
  });

  it('awaits iterator cleanup after an archive error', async () => {
    const archive = archiver('zip');
    archive.resume();
    const entered = promiseWithResolvers.withResolvers<void>();
    const release = promiseWithResolvers.withResolvers<void>();
    const cleaning = promiseWithResolvers.withResolvers<void>();
    const cleanup = promiseWithResolvers.withResolvers<void>();
    async function* rows() {
      try {
        entered.resolve();
        await release.promise;
        yield ['late'];
      } finally {
        cleaning.resolve();
        await cleanup.promise;
      }
    }
    const source = createBaseExportCsvStream(['value'], rows());
    let settled = false;
    const outcome = appendBaseExportEntry(archive, source, 'pending.csv').then(
      () => {
        settled = true;
      },
      (error: Error) => {
        settled = true;
        return error;
      }
    );
    await entered.promise;
    archive.emit('error', new Error('archive failed'));
    release.resolve();
    try {
      await cleaning.promise;
      await nextTurn();
      expect(settled).toBe(false);
      cleanup.resolve();
      expect(await outcome).toEqual(new Error('archive failed'));
    } finally {
      release.resolve();
      cleanup.resolve();
      archive.abort();
      source.destroy();
      await outcome;
    }
  });

  it('settles source failures even when close events are disabled', async () => {
    const archive = archiver('zip');
    archive.resume();
    const source = new Readable({ emitClose: false, read() {} });
    const running = appendBaseExportEntry(archive, source, 'no-close.csv');
    const rejected = expect(running).rejects.toThrow('source failed without close');
    source.destroy(new Error('source failed without close'));
    try {
      await rejected;
    } finally {
      archive.abort();
      source.destroy();
    }
  });
});
