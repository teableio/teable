import { once } from 'node:events';
import { createServer, get, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { streamSseResponse } from './sse-stream';

describe('streamSseResponse real HTTP transport', () => {
  it('stops source pulls behind a paused TCP consumer and delivers every frame after drain', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const start = Promise.withResolvers<void>();
    const stalled = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    const padding = 'x'.repeat(256 * 1024);
    let pulls = 0;
    let blockedTimer: NodeJS.Timeout | undefined;
    let serverResponse: ServerResponse | undefined;
    async function* source() {
      await start.promise;
      for (let sequence = 0; sequence < 128; sequence++) {
        pulls++;
        yield { id: 'progress', sequence, padding };
      }
      yield { id: 'done', sequence: 128 };
    }
    const server = createServer((_request, response) => {
      serverResponse = response;
      const write = response.write.bind(response);
      response.write = ((...args: Parameters<ServerResponse['write']>) => {
        const accepted = write(...args);
        if (!accepted) {
          blockedTimer = setTimeout(() => stalled.resolve(), 100);
          response.once('drain', () => clearTimeout(blockedTimer));
        }
        return accepted;
      }) as ServerResponse['write'];
      void streamSseResponse(response as Response, source(), () => ({
        id: 'error',
        sequence: -1,
      })).then(finished.resolve, finished.reject);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    let client: IncomingMessage | undefined;
    try {
      const connected = Promise.withResolvers<IncomingMessage>();
      const request = get(`http://127.0.0.1:${address.port}`, connected.resolve);
      request.on('error', connected.reject);
      client = await connected.promise;
      client.pause();
      start.resolve();
      await stalled.promise;
      const blockedPulls = pulls;
      expect(blockedPulls).toBeLessThan(128);
      await delay(100);
      expect(pulls).toBe(blockedPulls);
      expect(serverResponse?.writableNeedDrain).toBe(true);

      // Heartbeat intervals must not append frames while the data writer waits
      // for drain, even if many intervals pass with the consumer paused.
      const bufferedBytes = serverResponse?.writableLength;
      try {
        await vi.advanceTimersByTimeAsync(60_000);
        expect(serverResponse?.writableLength).toBe(bufferedBytes);
        expect(pulls).toBe(blockedPulls);
      } finally {
        vi.useRealTimers();
      }

      const sequences: number[] = [];
      let validPayloads = true;
      let buffer = '';
      client.setEncoding('utf8');
      client.on('data', (chunk: string) => {
        buffer += chunk;
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (frame.startsWith('data: ')) {
            const event = JSON.parse(frame.slice(6));
            sequences.push(event.sequence);
            validPayloads &&= event.id === 'done' || event.padding === padding;
          }
        }
      });
      const ended = once(client, 'end');
      client.resume();
      await ended;
      await finished.promise;
      expect(sequences).toEqual(Array.from({ length: 129 }, (_, index) => index));
      expect(validPayloads).toBe(true);
      expect(buffer).toBe('');
    } finally {
      vi.useRealTimers();
      clearTimeout(blockedTimer);
      client?.destroy();
      server.closeAllConnections();
      const closed = once(server, 'close');
      server.close();
      await closed;
    }
  }, 15_000);

  it.each(['disconnect', 'response error'] as const)(
    'aborts the source and closes its iterator during a blocked write on %s',
    async (failure) => {
      const start = Promise.withResolvers<void>();
      const blocked = Promise.withResolvers<void>();
      const finalized = Promise.withResolvers<void>();
      const finished = Promise.withResolvers<void>();
      let pulls = 0;
      let signal: AbortSignal | undefined;
      let serverResponse: ServerResponse | undefined;
      const server = createServer((_request, response) => {
        serverResponse = response;
        const write = response.write.bind(response);
        response.write = ((...args: Parameters<ServerResponse['write']>) => {
          const accepted = write(...args);
          if (!accepted) blocked.resolve();
          return accepted;
        }) as ServerResponse['write'];
        void streamSseResponse(
          response as Response,
          async function* (requestSignal) {
            signal = requestSignal;
            await start.promise;
            try {
              pulls++;
              yield { id: 'progress', padding: 'x'.repeat(16 * 1024 * 1024) };
              pulls++;
              yield { id: 'done' };
            } finally {
              finalized.resolve();
            }
          },
          () => ({ id: 'error' })
        ).then(finished.resolve, finished.reject);
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address() as AddressInfo;
      let client: IncomingMessage | undefined;
      try {
        const connected = Promise.withResolvers<IncomingMessage>();
        const request = get(`http://127.0.0.1:${address.port}`, connected.resolve);
        request.on('error', connected.reject);
        client = await connected.promise;
        client.on('error', () => undefined);
        client.pause();
        start.resolve();
        await blocked.promise;
        expect(serverResponse?.writableNeedDrain).toBe(true);
        if (failure === 'disconnect') {
          client.destroy();
        } else {
          serverResponse?.destroy(new Error('socket failed'));
        }
        await finished.promise;
        await finalized.promise;
        expect(signal?.aborted).toBe(true);
        expect(pulls).toBe(1);
      } finally {
        client?.destroy();
        server.closeAllConnections();
        const closed = once(server, 'close');
        server.close();
        await closed;
      }
    },
    15_000
  );

  it('aborts an idle pending pull and runs its generator cleanup on disconnect', async () => {
    const waiting = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    let signal: AbortSignal | undefined;
    let finalized = false;
    const server = createServer((_request, response) => {
      void streamSseResponse(
        response as Response,
        async function* (requestSignal) {
          signal = requestSignal;
          try {
            const aborted = Promise.withResolvers<void>();
            requestSignal.addEventListener('abort', () => aborted.resolve(), { once: true });
            waiting.resolve();
            await aborted.promise;
            yield { id: 'done' };
          } finally {
            finalized = true;
          }
        },
        () => ({ id: 'error' })
      ).then(finished.resolve, finished.reject);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    let client: IncomingMessage | undefined;
    try {
      const connected = Promise.withResolvers<IncomingMessage>();
      get(`http://127.0.0.1:${address.port}`, connected.resolve).on('error', connected.reject);
      client = await connected.promise;
      await waiting.promise;
      client.destroy();
      await finished.promise;
      expect(signal?.aborted).toBe(true);
      expect(finalized).toBe(true);
    } finally {
      client?.destroy();
      server.closeAllConnections();
      const closed = once(server, 'close');
      server.close();
      await closed;
    }
  });

  it('writes the unchanged payload followed by exactly one error frame for a thrown source', async () => {
    const finished = Promise.withResolvers<void>();
    let finalized = false;
    async function* source() {
      try {
        yield { id: 'progress', sequence: 0 };
        throw new Error('source failed');
      } finally {
        finalized = true;
      }
    }
    const server = createServer((_request, response) => {
      void streamSseResponse(response as Response, source(), (error, lastEvent) => ({
        id: 'error',
        sequence: -1,
        message: error instanceof Error ? error.message : 'failed',
        previousSequence: lastEvent?.sequence,
      })).then(finished.resolve, finished.reject);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    try {
      const received = Promise.withResolvers<string>();
      get(`http://127.0.0.1:${address.port}`, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('error', received.reject);
        response.on('end', () => received.resolve(body));
      }).on('error', received.reject);
      const body = await received.promise;
      await finished.promise;
      expect(body).toBe(
        'data: {"id":"progress","sequence":0}\n\n' +
          'data: {"id":"error","sequence":-1,"message":"source failed","previousSequence":0}\n\n'
      );
      expect(finalized).toBe(true);
    } finally {
      server.closeAllConnections();
      const closed = once(server, 'close');
      server.close();
      await closed;
    }
  });

  it.each([undefined, 'error', 'done'] as const)(
    'preserves per-chunk errors unless the protocol opts into terminal frames (%s)',
    async (terminalEventId) => {
      const finished = Promise.withResolvers<void>();
      let pullsAfterError = 0;
      let finalized = false;
      async function* source() {
        try {
          yield { id: 'progress', sequence: 0 };
          yield { id: 'error', sequence: 1 };
          pullsAfterError++;
          yield { id: 'progress', sequence: 2 };
          yield { id: 'done', sequence: 3 };
          throw new Error('must not duplicate an opted-in terminal frame');
        } finally {
          finalized = true;
        }
      }
      const server = createServer((_request, response) => {
        void streamSseResponse(
          response as Response,
          source(),
          () => ({ id: 'error', sequence: -1 }),
          terminalEventId ? { isTerminalEvent: (event) => event.id === terminalEventId } : undefined
        ).then(finished.resolve, finished.reject);
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address() as AddressInfo;
      try {
        const received = Promise.withResolvers<string>();
        get(`http://127.0.0.1:${address.port}`, (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            body += chunk;
          });
          response.on('error', received.reject);
          response.on('end', () => received.resolve(body));
        }).on('error', received.reject);
        const body = await received.promise;
        await finished.promise;
        const events = body
          .trim()
          .split('\n\n')
          .map((frame) => JSON.parse(frame.slice(6)));
        const expectedEvents = [
          { id: 'progress', sequence: 0 },
          { id: 'error', sequence: 1 },
          { id: 'progress', sequence: 2 },
          { id: 'done', sequence: 3 },
          { id: 'error', sequence: -1 },
        ];
        expect(events).toEqual(
          terminalEventId === 'error'
            ? expectedEvents.slice(0, 2)
            : terminalEventId === 'done'
              ? expectedEvents.slice(0, 4)
              : expectedEvents
        );
        expect(pullsAfterError).toBe(terminalEventId === 'error' ? 0 : 1);
        expect(finalized).toBe(true);
      } finally {
        server.closeAllConnections();
        const closed = once(server, 'close');
        server.close();
        await closed;
      }
    }
  );
});
