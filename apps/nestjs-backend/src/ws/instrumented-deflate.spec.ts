import deflate from 'permessage-deflate';
import type { IPermessageDeflateMessage, IPermessageDeflateSession } from 'permessage-deflate';
import { describe, it, expect } from 'vitest';
import { getCompressionSnapshot } from '../share-db/metrics/compression-metrics';
import { instrumentDeflate } from './instrumented-deflate';

/**
 * Counters are module-level (same reason as query-poll-skip-metrics: the deflate
 * extension is not a Nest provider), so every assertion here is on a delta
 * rather than an absolute — no test-only reset hook on the production module.
 */
const delta = (before: ReturnType<typeof getCompressionSnapshot>) => {
  const after = getCompressionSnapshot();
  return {
    frames: after.outbound.frames - before.outbound.frames,
    uncompressed: after.outbound.uncompressedBytes - before.outbound.uncompressedBytes,
    compressed: after.outbound.compressedBytes - before.outbound.compressedBytes,
    sessions: after.sessionsCreated - before.sessionsCreated,
    active: after.sessionsActive - before.sessionsActive,
  };
};

const sendThrough = (session: IPermessageDeflateSession, message: IPermessageDeflateMessage) =>
  new Promise<void>((resolve, reject) =>
    session.processOutgoingMessage(message, (error) => (error ? reject(error) : resolve()))
  );

const openSession = () => {
  const extension = instrumentDeflate(
    deflate.configure({ level: 3, maxWindowBits: 13, memLevel: 6, requestMaxWindowBits: 13 })
  );
  const session = extension.createServerSession([{ client_max_window_bits: true }]);
  if (!session) throw new Error('expected the browser-shaped offer to be accepted');
  session.generateResponse();
  return session;
};

describe('instrumentDeflate', () => {
  it('accounts for the bytes a frame saved, so the ratio is observable in production', async () => {
    const payload = JSON.stringify(
      Array.from({ length: 400 }, (_, i) => ({ fldTitleAaBbCcDd: `Customer account ${i}` }))
    );
    const before = getCompressionSnapshot();

    const session = openSession();
    await sendThrough(session, { data: Buffer.from(payload, 'utf8'), rsv1: false });
    session.close();

    const d = delta(before);
    expect(d.sessions).toBe(1);
    expect(d.frames).toBe(1);
    expect(d.active).toBe(0); // opened and closed within the test
    expect(d.uncompressed).toBe(Buffer.byteLength(payload));
    expect(d.compressed).toBeGreaterThan(0);
    expect(d.compressed).toBeLessThan(Buffer.byteLength(payload) / 5);
  });

  it('leaves the compressed payload intact for the driver to frame', async () => {
    // The wrapper must hand websocket-driver the same message object the real
    // session produced, rsv1 flag and all, or every frame goes out malformed.
    const session = openSession();
    const message: IPermessageDeflateMessage = {
      data: Buffer.from('x'.repeat(2000), 'utf8'),
      rsv1: false,
    };

    await sendThrough(session, message);
    session.close();

    expect(message.rsv1).toBe(true);
    expect(message.data.length).toBeLessThan(2000);
  });

  it('tracks how many sessions are holding zlib contexts right now', async () => {
    // This is the number the memory budget is built on: live deflate+inflate
    // pairs, not connections (xhr-streaming holds none) and not sessions ever
    // created. Without the decrement it would climb forever and read as a leak.
    const before = getCompressionSnapshot();

    const a = openSession();
    const b = openSession();
    expect(getCompressionSnapshot().sessionsActive).toBe(before.sessionsActive + 2);

    a.close();
    expect(getCompressionSnapshot().sessionsActive).toBe(before.sessionsActive + 1);

    b.close();
    expect(getCompressionSnapshot().sessionsActive).toBe(before.sessionsActive);
  });
});
