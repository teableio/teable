import type { ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import { Readable } from 'node:stream';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import type archiver from 'archiver';
import { stringify } from 'csv-stringify/sync';

const promiseWithResolvers = Promise as unknown as {
  withResolvers<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
};

const BYTE_BUDGET = 64 * 1024;
const TIME_BUDGET_MS = 8;
// Each UTF-16 code unit needs at most three UTF-8 bytes. Leave surrogate pairs intact.
const CHUNK_CODE_UNITS = Math.floor(BYTE_BUDGET / 3);

/** Owns only this caller's close listener, shared by the JSON and SSE routes. */
export const observeBaseExportDisconnect = (
  response: Pick<ServerResponse, 'once' | 'removeListener' | 'writableFinished'>
): { signal: AbortSignal; dispose: () => void } => {
  const controller = new AbortController();
  const onClose = () => {
    if (!response.writableFinished) {
      controller.abort(new DOMException('Export client disconnected', 'AbortError'));
    }
  };
  response.once('close', onClose);
  return {
    signal: controller.signal,
    dispose: () => response.removeListener('close', onClose),
  };
};

/** Only a caller-disconnect abort is cancellation; lease/storage failures remain failures. */
export const isBaseExportCancelled = (signal: AbortSignal): boolean => {
  const reason: unknown = signal.reason;
  return (
    signal.aborted &&
    typeof reason === 'object' &&
    reason !== null &&
    'name' in reason &&
    reason.name === 'AbortError'
  );
};

const cancellationError = (signal: AbortSignal): Error => {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error('Base export cancelled');
  error.name = 'AbortError';
  return error;
};

/**
 * Rows already contain raw physical values serialized by the caller, in header order.
 * Retains only the current input row and its CSV string, plus bounded byte buffers.
 * A single synchronous stringify call cannot be preempted; yielding resumes between
 * chunks/rows, and a pending iterator.next() must settle before iterator cleanup can finish.
 */
export const createBaseExportCsvStream = (
  headers: readonly string[],
  rows: AsyncIterable<readonly unknown[]>,
  signal?: AbortSignal
): Readable => {
  let iterator: AsyncIterator<readonly unknown[]> | undefined;
  let workBytes = 0;
  let workStarted = performance.now();
  const active = () => {
    if (signal?.aborted) throw cancellationError(signal);
    return !stream.destroyed;
  };

  async function* encodeRow(row: readonly unknown[]): AsyncGenerator<Buffer> {
    if (!active()) return;
    // csv-stringify reads the record without mutating it; borrow it rather than copying it.
    const csv = stringify([row as unknown[]]);
    for (let offset = 0; offset < csv.length;) {
      if (!active()) return;
      let end = Math.min(offset + CHUNK_CODE_UNITS, csv.length);
      const last = csv.charCodeAt(end - 1);
      const next = csv.charCodeAt(end);
      if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
      const chunk = Buffer.from(csv.slice(offset, end), 'utf8');
      offset = end;
      workBytes += chunk.byteLength;
      yield chunk;
      if (!active()) return;
      if (workBytes >= BYTE_BUDGET || performance.now() - workStarted >= TIME_BUDGET_MS) {
        await yieldToEventLoop();
        if (!active()) return;
        workBytes = 0;
        workStarted = performance.now();
      }
    }
  }

  async function* generate(): AsyncGenerator<Buffer> {
    try {
      if (!active()) return;
      yield* encodeRow(headers);
      if (!active()) return;
      iterator = rows[Symbol.asyncIterator]();
      while (active()) {
        const result = await iterator.next();
        if (!active() || result.done) return;
        yield* encodeRow(result.value);
      }
    } finally {
      await iterator?.return?.();
    }
  }

  const stream = Readable.from(generate(), { objectMode: false, highWaterMark: BYTE_BUDGET });
  const abort = () => stream.destroy(cancellationError(signal!));
  if (signal) {
    signal.addEventListener('abort', abort, { once: true });
    stream.once('close', () => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  }
  return stream;
};

/** Waits for this entry's reader, rather than the archive's eventual finalize(). */
export const appendBaseExportEntry = (
  archive: archiver.Archiver,
  source: Readable,
  name: string,
  signal?: AbortSignal
): Promise<void> => {
  const { promise, resolve, reject } = promiseWithResolvers.withResolvers<void>();
  let settled = false;
  let failure: Error | undefined;
  const cleanup = () => {
    source.off('end', onEnd);
    source.off('error', onSourceError);
    source.off('close', onClose);
    archive.off('error', fail);
    archive.off('close', onArchiveClose);
    archive.off('finish', onArchiveClose);
    signal?.removeEventListener('abort', onAbort);
  };
  const settle = () => {
    if (settled) return;
    settled = true;
    cleanup();
    if (failure) reject(failure);
    else resolve();
  };
  const fail = (error: unknown) => {
    failure ??= error instanceof Error ? error : new Error(String(error));
    // Keep the error observer until close: destroy emits its error asynchronously.
    const alreadyClosed = source.closed;
    source.destroy(failure);
    if (alreadyClosed) setImmediate(settle);
  };
  const onSourceError = (error: Error) => {
    failure ??= error;
    // An error emitted after _destroy also covers sources configured with emitClose: false.
    if (source.closed) settle();
    else fail(error);
  };
  const onEnd = () => {
    if (!failure) settle();
  };
  const onClose = () => {
    if (!source.readableEnded)
      failure ??= new Error(`Export entry ${name} closed before it finished`);
    settle();
  };
  const onArchiveClose = () => fail(new Error(`Export archive closed while reading ${name}`));
  const onAbort = () => fail(cancellationError(signal!));

  // append can synchronously throw or emit an error, so register every observer first.
  source.on('error', onSourceError);
  source.once('end', onEnd);
  source.once('close', onClose);
  archive.on('error', fail);
  archive.once('close', onArchiveClose);
  archive.once('finish', onArchiveClose);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) {
    onAbort();
    return promise;
  }
  if (source.destroyed || archive.destroyed) {
    fail(source.errored ?? new Error(`Export entry ${name} is already closed`));
    return promise;
  }
  try {
    archive.append(source, { name });
    if (source.readableEnded) onEnd();
  } catch (error) {
    fail(error);
  }
  return promise;
};
