import http from 'http';
import type { AddressInfo, Socket } from 'net';
import sockjs from 'sockjs';
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { getCompressionSnapshot } from '../share-db/metrics/compression-metrics';
import { createSockjsServerOptions } from './sockjs-options';

/**
 * These tests drive a real SockJS server over a real WebSocket client, because
 * permessage-deflate only exists as a handshake negotiation plus RSV1 framing —
 * asserting on the options object would prove nothing about either.
 */

/** ~90 KiB of record snapshots, matching what ShareDB pushes on a grid load. */
const buildSnapshotPayload = () =>
  JSON.stringify({
    a: 'q',
    id: 1,
    data: Array.from({ length: 200 }, (_, i) => ({
      d: `rec${String(i).padStart(13, 'A')}`,
      v: 3,
      type: 'http://sharedb.org/types/json0',
      data: {
        id: `rec${String(i).padStart(13, 'A')}`,
        fields: {
          fldTitleAaBbCcDd: `Customer account ${i} — western region`,
          fldStatusEeFfGg1: ['Active', 'Pending review', 'Churned'][i % 3],
          fldOwnerHhIiJjKk: { id: `usr${i % 7}`, title: `Team Member ${i % 7}` },
          fldNotesSsTtUuVv: `Follow-up scheduled. Renewal pending for cycle ${i}.`,
        },
        createdTime: '2026-05-10T04:12:33.000Z',
        lastModifiedTime: '2026-07-20T11:05:12.000Z',
      },
    })),
  });

interface IHarness {
  /** Negotiated `Sec-WebSocket-Extensions` response header, or undefined. */
  negotiated?: string;
  /**
   * Total bytes the server wrote to the TCP socket for this connection. The
   * server pushes the payload immediately on connect, so a delta measured from
   * the client-observed `o` frame races the write — the total (payload plus a
   * ~250 byte upgrade response) is the only stable reading.
   */
  bytesOnWire: number;
  /** Payloads as the client decoded them, after SockJS unframing. */
  received: string[];
}

const teardown: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (teardown.length) await teardown.pop()!();
});

/**
 * Boots a real SockJS server that pushes `payloads` on connect, connects with a
 * browser-shaped offer (`permessage-deflate; client_max_window_bits`) and
 * reports what crossed the wire. SockJS flushes its send buffer on every
 * `write` (`transport.js` `Session.send`), so each payload leaves as its own
 * WebSocket frame and gets its own deflate pass.
 */
async function connectAndReceive(
  payloads: string[],
  // ws sends a bare `client_max_window_bits` for `true`, which is exactly the
  // offer Chrome and Firefox make.
  offer: WebSocket.ClientOptions['perMessageDeflate'] = true
): Promise<IHarness> {
  const httpServer = http.createServer();
  const sockjsServer = sockjs.createServer(createSockjsServerOptions(() => undefined));
  sockjsServer.on('connection', (conn) => payloads.forEach((p) => conn.write(p)));
  sockjsServer.installHandlers(httpServer);

  let serverSocket: Socket | undefined;
  httpServer.on('connection', (socket) => (serverSocket = socket));

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as AddressInfo;

  const client = new WebSocket(`ws://127.0.0.1:${port}/socket/000/vitest/websocket`, {
    perMessageDeflate: offer,
  });

  teardown.push(async () => {
    client.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  let negotiated: string | undefined;
  client.on('upgrade', (res) => (negotiated = res.headers['sec-websocket-extensions']));

  const result = await new Promise<IHarness>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('timed out waiting for SockJS payloads')),
      5000
    );
    const received: string[] = [];

    client.on('error', reject);
    client.on('message', (raw) => {
      const frame = raw.toString();
      // SockJS opens with `o`, then delivers messages as `a["<json string>",…]`.
      if (!frame.startsWith('a')) return;
      received.push(...(JSON.parse(frame.slice(1)) as string[]));
      if (received.length < payloads.length) return;
      clearTimeout(timer);
      resolve({ negotiated, bytesOnWire: serverSocket?.bytesWritten ?? 0, received });
    });
  });

  return result;
}

describe('createSockjsServerOptions', () => {
  it('negotiates permessage-deflate against a browser-shaped offer', async () => {
    const { negotiated } = await connectAndReceive(['hello']);

    expect(negotiated).toMatch(/(^|[,;\s])permessage-deflate\b/);
  });

  it('caps the client deflate window at 13 bits to bound the server inflater', async () => {
    // The inflate side is allocated from the *peer's* window (session.js
    // `_getInflate`), so only client_max_window_bits keeps it off 32 KiB.
    const { negotiated } = await connectAndReceive(['hello']);

    expect(negotiated).toContain('client_max_window_bits=13');
  });

  it('caps its own deflate window at 13 bits, the dominant per-connection cost', async () => {
    // zlib sizes the deflater at 1<<(windowBits+2) plus 1<<(memLevel+9): 256 KiB
    // at defaults against 64 KiB here. Measured across 800 live connections that
    // is ~398 KiB/conn versus ~250 KiB/conn — the difference between fitting and
    // not fitting on a small box.
    //
    // permessage-deflate only echoes server_max_window_bits when the peer named
    // it (server_session.js, a Firefox workaround), so the offer has to ask.
    const { negotiated } = await connectAndReceive(['hello'], { serverMaxWindowBits: 15 });

    expect(negotiated).toContain('server_max_window_bits=13');
  });

  it('delivers a grid-load payload compressed and byte-identical', async () => {
    const payload = buildSnapshotPayload();

    const { bytesOnWire, received } = await connectAndReceive([payload]);

    expect(received).toEqual([payload]);
    expect(payload.length).toBeGreaterThan(80 * 1024);
    // Measured ~10-19x on this shape; 5x is a floor that only an uncompressed
    // connection can miss.
    expect(bytesOnWire).toBeLessThan(payload.length / 5);
  });

  it('counts what it compressed, so the live ratio is observable', async () => {
    // Guards the wiring, not the counters: without instrumentDeflate() in the
    // production path every compression test above still passes while the
    // metrics stay flat at zero.
    const payload = buildSnapshotPayload();
    const before = getCompressionSnapshot();

    await connectAndReceive([payload]);

    const after = getCompressionSnapshot();
    expect(after.sessionsCreated).toBe(before.sessionsCreated + 1);
    expect(
      after.outbound.uncompressedBytes - before.outbound.uncompressedBytes
    ).toBeGreaterThanOrEqual(payload.length);
    expect(after.outbound.compressedBytes - before.outbound.compressedBytes).toBeLessThan(
      payload.length / 5
    );
  });

  it('keeps the deflate dictionary across ops so steady-state traffic stays small', async () => {
    // Each op is its own frame, so this is the case context takeover decides:
    // with it, later ops cost a handful of bytes; with `noContextTakeover`
    // every op restarts from an empty dictionary and the ratio falls to ~1.4x.
    const ops = Array.from({ length: 300 }, (_, i) =>
      JSON.stringify({
        a: 'op',
        c: 'record_tblXyZ123456789Ab',
        d: `rec${String(i).padStart(13, 'A')}`,
        v: 4 + (i % 20),
        op: [{ p: ['record', 'fields', 'fldStatusEeFfGg1'], oi: 'Active', od: 'Pending review' }],
        src: 'a1b2c3d4e5f6a7b8c9d0e1f2',
        seq: i,
      })
    );
    const rawBytes = ops.reduce((sum, op) => sum + op.length, 0);

    const { bytesOnWire, received } = await connectAndReceive(ops);

    expect(received).toEqual(ops);
    expect(bytesOnWire).toBeLessThan(rawBytes / 5);
  });
});
