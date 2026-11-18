import type { Response } from 'express';

type IFlushableResponse = Response & { flush?: () => void };
export type SseStreamSource<T> =
  | AsyncIterable<T>
  | ((signal: AbortSignal) => AsyncIterable<T> | Promise<AsyncIterable<T>>);

export interface ISseStreamOptions<T> {
  /** Opt in only when the protocol defines emitted error/done events as terminal. */
  isTerminalEvent?: (event: T) => boolean;
}

const HEARTBEAT_INTERVAL_MS = 15_000;

export const isSseStreamClosed = (response: Response) =>
  response.writableEnded || response.destroyed;

// A false write has accepted this frame, but no subsequent frame or source pull
// may start until drain. Aborting also releases a writer blocked on drain.
const writeSseFrame = async (response: Response, frame: string, signal: AbortSignal) => {
  if (signal.aborted || isSseStreamClosed(response)) return;
  // This package's ES2022 lib target does not declare Promise.withResolvers.
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const cleanup = () => {
    response.off('drain', onDrain);
    response.off('error', onError);
    signal.removeEventListener('abort', onAbort);
  };
  const onDrain = () => {
    cleanup();
    resolve();
  };
  const onError = (error: Error) => {
    cleanup();
    reject(error);
  };
  const onAbort = () => {
    cleanup();
    resolve();
  };
  response.once('drain', onDrain);
  response.once('error', onError);
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const writable = response.write(frame);
    (response as IFlushableResponse).flush?.();
    if (writable || signal.aborted) onDrain();
  } catch (error) {
    cleanup();
    reject(error);
  }
  await promise;
};

// Own one pending next() and its idle wait. Heartbeats reuse the same writer,
// and abort releases the wait without adding reactions to the pending pull.
const pullSseEvent = async <T>(
  iterator: AsyncIterator<T>,
  response: Response,
  signal: AbortSignal
): Promise<IteratorResult<T> | undefined> => {
  if (signal.aborted || isSseStreamClosed(response)) return;
  const pending: {
    result?: { kind: 'event'; value: IteratorResult<T> } | { kind: 'error'; error: unknown };
  } = {};
  let timer: NodeJS.Timeout | undefined;
  let wakeWaiting: (() => void) | undefined;
  const stopWaiting = () => wakeWaiting?.();
  signal.addEventListener('abort', stopWaiting, { once: true });
  try {
    // Register once per pull: repeated Promise.race calls would retain an
    // additional reaction on a long-running next() for every heartbeat.
    void iterator.next().then(
      (value) => {
        pending.result = { kind: 'event', value };
        wakeWaiting?.();
      },
      (error: unknown) => {
        pending.result = { kind: 'error', error };
        wakeWaiting?.();
      }
    );
    while (!pending.result && !signal.aborted) {
      const promise = new Promise<void>((resolve) => {
        wakeWaiting = resolve;
        timer = setTimeout(resolve, HEARTBEAT_INTERVAL_MS);
      });
      await promise;
      clearTimeout(timer);
      wakeWaiting = undefined;
      if (!pending.result && !signal.aborted) {
        await writeSseFrame(response, ': ping\n\n', signal);
      }
    }
    if (signal.aborted) return;
    const result = pending.result;
    if (result?.kind === 'error') throw result.error;
    return result?.value;
  } finally {
    clearTimeout(timer);
    wakeWaiting = undefined;
    signal.removeEventListener('abort', stopWaiting);
  }
};

// One source pull and one writer at a time. Idle heartbeats share that writer,
// rather than accumulating an independent queue behind a slow socket. Existing
// callers keep their data payloads and nonterminal per-chunk errors unchanged.
export const streamSseResponse = async <T>(
  response: Response,
  source: SseStreamSource<T>,
  buildErrorEvent: (error: unknown, lastEvent?: T) => T,
  options?: ISseStreamOptions<T>
): Promise<void> => {
  const abort = new AbortController();
  let responseError: Error | undefined;
  const onClose = () => abort.abort();
  const onError = (error: Error) => {
    responseError = error;
    abort.abort();
  };
  response.on('close', onClose);
  response.on('error', onError);
  let iterator: AsyncIterator<T> | undefined;
  let terminal = false;
  let lastEvent: T | undefined;
  try {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    if (isSseStreamClosed(response)) return;
    const stream = typeof source === 'function' ? await source(abort.signal) : source;
    iterator = stream[Symbol.asyncIterator]();
    while (!terminal) {
      const result = await pullSseEvent(iterator, response, abort.signal);
      if (!result || result.done) break;
      lastEvent = result.value;
      terminal = options?.isTerminalEvent?.(lastEvent) ?? false;
      await writeSseFrame(response, `data: ${JSON.stringify(lastEvent)}\n\n`, abort.signal);
    }
  } catch (error) {
    if (!terminal && !abort.signal.aborted && !isSseStreamClosed(response)) {
      terminal = true;
      await writeSseFrame(
        response,
        `data: ${JSON.stringify(buildErrorEvent(error, lastEvent))}\n\n`,
        abort.signal
      );
    }
  } finally {
    abort.abort();
    try {
      await iterator?.return?.();
    } finally {
      response.off('close', onClose);
      response.off('error', onError);
      if (!responseError && !isSseStreamClosed(response)) response.end();
    }
  }
};
