import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ColdStorageUnavailableError } from './cold-errors';
import { ColdPartByteCache } from './part-byte-cache';

describe('cold part byte cache', () => {
  const cacheOf = () =>
    new ColdPartByteCache(async () => Readable.from(Buffer.alloc(0))) as unknown as {
      put: (cacheKey: string, buffer: Buffer) => void;
      bytes: number;
      entries: Map<string, Buffer>;
    };

  it('re-caching the same key under concurrent misses does not leak phantom bytes', () => {
    const cache = cacheOf();
    cache.put('k@etag1', Buffer.alloc(1024, 1));
    cache.put('k@etag1', Buffer.alloc(1024, 2));
    expect(cache.bytes).toBe(1024);
    expect(cache.entries.size).toBe(1);
  });

  it('a connection dropped mid-body degrades instead of surfacing as a defect', async () => {
    // download() resolves fine; the socket dies while the body streams
    const cache = new ColdPartByteCache(async () =>
      Readable.from(
        (async function* () {
          yield Buffer.alloc(8, 1);
          throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
        })()
      )
    );
    await expect(
      cache.streamFor('part', { etag: 'e1', size: 16 }, Date.now() + 60_000)
    ).rejects.toBeInstanceOf(ColdStorageUnavailableError);
  });
});
