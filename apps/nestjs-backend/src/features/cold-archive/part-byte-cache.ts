import { Readable } from 'node:stream';
import { ColdReadDeadlineError, coldStorageRead } from './cold-errors';

const PART_CACHE_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const PART_CACHE_MAX_ENTRY_BYTES = 16 * 1024 * 1024;

/**
 * Etag-keyed LRU of compressed part bytes for the READ paths.
 *
 * The etag is what makes caching safe: the flusher/compactor run in another
 * process, so a key-addressed cache could serve clobbered content, whereas an
 * in-place rewrite changes the etag and misses by construction. WRITE paths
 * must not use this — they read parts they are about to replace.
 *
 * The deadline also bounds the buffering download itself, which would
 * otherwise run to completion before the caller's per-row checks see a byte.
 */
export class ColdPartByteCache {
  private readonly entries = new Map<string, Buffer>();
  private bytes = 0;

  constructor(private readonly download: (key: string) => Promise<Readable>) {}

  /**
   * The part's compressed bytes, from cache when the version is cacheable and
   * already held. An uncacheable part (no etag, or over the entry cap) is
   * still buffered to honor a deadline; only a deadline-less caller streams
   * straight through, never materializing the part.
   */
  async streamFor(
    key: string,
    version: { etag?: string; size?: number },
    deadline?: number
  ): Promise<Readable> {
    if (!version.etag || (version.size ?? Infinity) > PART_CACHE_MAX_ENTRY_BYTES) {
      if (deadline === undefined) return coldStorageRead(() => this.download(key));
      return Readable.from(await this.downloadWithDeadline(key, deadline));
    }
    const cacheKey = `${key}@${version.etag}`;
    const cached = this.entries.get(cacheKey);
    if (cached) {
      // re-insert to refresh the LRU position
      this.entries.delete(cacheKey);
      this.entries.set(cacheKey, cached);
      return Readable.from(cached);
    }
    const buffer = await this.downloadWithDeadline(key, deadline);
    this.put(cacheKey, buffer);
    return Readable.from(buffer);
  }

  // the socket can fail mid-body, after download() resolved: classify the
  // whole read so a dropped connection degrades instead of surfacing as a 500
  private async downloadWithDeadline(key: string, deadline?: number): Promise<Buffer> {
    return coldStorageRead(async () => {
      const stream = await this.download(key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        if (deadline !== undefined && Date.now() > deadline) {
          stream.destroy();
          throw new ColdReadDeadlineError(`download of ${key} exceeded the cold read budget`);
        }
        chunks.push(chunk as Buffer);
      }
      return Buffer.concat(chunks);
    });
  }

  private put(cacheKey: string, buffer: Buffer) {
    if (buffer.length > PART_CACHE_MAX_ENTRY_BYTES) return;
    // two requests can miss the same key concurrently: replacing without
    // reclaiming the first entry's bytes leaves phantom bytes in the counter
    const existing = this.entries.get(cacheKey);
    if (existing) {
      this.bytes -= existing.length;
      this.entries.delete(cacheKey);
    }
    this.entries.set(cacheKey, buffer);
    this.bytes += buffer.length;
    while (this.bytes > PART_CACHE_MAX_TOTAL_BYTES && this.entries.size > 0) {
      const oldest = this.entries.keys().next().value as string;
      const evicted = this.entries.get(oldest);
      this.entries.delete(oldest);
      this.bytes -= evicted?.length ?? 0;
    }
  }
}
