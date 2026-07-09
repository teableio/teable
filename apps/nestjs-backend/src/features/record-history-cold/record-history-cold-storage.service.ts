import { Readable } from 'node:stream';
import { Injectable, Logger } from '@nestjs/common';
import { UploadType } from '@teable/openapi';
import StorageAdapter from '../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../attachments/plugins/storage';
import type { IColdHistoryRow, IParsedPartKey, IPartFooter, ITableColdStats } from './part-codec';
import {
  coldRootDir,
  iteratePartRows,
  monthPrefix,
  parsePartKey,
  statsKey,
  tablePrefix,
} from './part-codec';
import type { IPartStore } from './part-writer';

const PART_CACHE_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const PART_CACHE_MAX_ENTRY_BYTES = 16 * 1024 * 1024;

/** thrown when a part download outlives the caller's read deadline */
export class ColdReadDeadlineError extends Error {}

/**
 * Storage facade for record-history cold parts on the private bucket:
 * key listing (two-level: month prefixes → parts of a month), `_stats.json`
 * maintenance, and prefix deletion for table purges.
 *
 * Listings/downloads used by the WRITE paths are cache-free: parts are
 * rewritten by the flusher/compactor running in another process, so a
 * key-addressed byte cache can serve clobbered content. The READ path may
 * use `iterateRowsCached`, which is keyed by key@etag from a live listing —
 * a rewrite changes the etag and misses the cache by construction.
 */
@Injectable()
export class RecordHistoryColdStorageService {
  private readonly logger = new Logger(RecordHistoryColdStorageService.name);
  private readonly partCache = new Map<string, Buffer>();
  private partCacheBytes = 0;

  constructor(@InjectStorageAdapter() private readonly storageAdapter: StorageAdapter) {}

  get bucket(): string {
    return StorageAdapter.getBucket(UploadType.RecordHistory);
  }

  get rootDir(): string {
    return StorageAdapter.getDir(UploadType.RecordHistory);
  }

  /** the minimal store surface used by PartWriter (upload + verify + cleanup) */
  get partStore(): IPartStore {
    return {
      upload: async (key, stream) => {
        await this.storageAdapter.uploadFileStream(this.bucket, key, stream, {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/x-ndjson',
        });
      },
      download: (key) => this.storageAdapter.downloadFile(this.bucket, key),
      delete: async (key) => {
        await this.storageAdapter.deleteFile(this.bucket, key);
      },
    };
  }

  /** every table that has cold data (top-level prefixes under the version root) */
  async listTables(): Promise<string[]> {
    const { prefixes } = await this.storageAdapter.listObjects(
      this.bucket,
      `${coldRootDir(this.rootDir)}/`,
      { delimiter: '/' }
    );
    return prefixes
      .map((prefix) => /\/(tbl[A-Za-z0-9]+)\/$/.exec(prefix)?.[1])
      .filter((tableId): tableId is string => Boolean(tableId));
  }

  /**
   * always a live LIST: the flusher/compactor run in a different process
   * than the readers, so any cross-request cache here would hide a freshly
   * created month dir (right after its buffer rows were deleted). Reads only
   * reach S3 when the buffer cannot fill the page, so the LIST is rare.
   */
  async listMonths(tableId: string): Promise<string[]> {
    const { prefixes } = await this.storageAdapter.listObjects(
      this.bucket,
      tablePrefix(this.rootDir, tableId),
      { delimiter: '/' }
    );
    return prefixes
      .map((prefix) => /\/(\d{6})\/$/.exec(prefix)?.[1])
      .filter((month): month is string => Boolean(month))
      .sort()
      .reverse();
  }

  async listMonthParts(
    tableId: string,
    yyyymm: string
  ): Promise<Array<IParsedPartKey & { size: number; etag?: string }>> {
    const { objects } = await this.storageAdapter.listObjects(
      this.bucket,
      monthPrefix(this.rootDir, tableId, yyyymm)
    );
    const parts: Array<IParsedPartKey & { size: number; etag?: string }> = [];
    for (const object of objects) {
      const parsed = parsePartKey(this.rootDir, object.key);
      if (!parsed) continue;
      const part: IParsedPartKey & { size: number; etag?: string } = {
        ...parsed,
        size: object.size,
      };
      if (object.etag !== undefined) part.etag = object.etag;
      parts.push(part);
    }
    return parts;
  }

  async readStats(tableId: string): Promise<ITableColdStats | undefined> {
    try {
      const stream = await this.storageAdapter.downloadFile(
        this.bucket,
        statsKey(this.rootDir, tableId)
      );
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ITableColdStats;
      return parsed.version === 1 ? parsed : undefined;
    } catch (error) {
      // stats are an advisory cache: any miss/corruption degrades to part scans
      this.logger.debug(
        `no readable cold stats for table ${tableId}: ${error instanceof Error ? error.message : error}`
      );
      return undefined;
    }
  }

  async writeStats(tableId: string, stats: ITableColdStats): Promise<void> {
    const body = Buffer.from(JSON.stringify(stats));
    await this.storageAdapter.uploadFileStream(
      this.bucket,
      statsKey(this.rootDir, tableId),
      Readable.from(body),
      {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'application/json',
      }
    );
  }

  /** stream-decode a part's rows straight off the storage stream */
  async *iterateRows(
    key: string
  ): AsyncGenerator<{ row?: IColdHistoryRow; footer?: IPartFooter; rowLine?: string }> {
    const stream = await this.storageAdapter.downloadFile(this.bucket, key);
    yield* iteratePartRows(key, stream);
  }

  /**
   * read-path variant with an etag-keyed LRU of compressed bytes: paging
   * over the same parts skips repeated downloads, and an in-place rewrite
   * (new etag from the live listing) misses the cache by construction.
   * The optional deadline also bounds the buffering download itself — a
   * slow GET would otherwise run to completion before the caller's
   * per-row deadline checks ever see a byte.
   */
  async *iterateRowsCached(
    key: string,
    version: { etag?: string; size?: number },
    deadline?: number
  ): AsyncGenerator<{ row?: IColdHistoryRow; footer?: IPartFooter; rowLine?: string }> {
    if (!version.etag || (version.size ?? Infinity) > PART_CACHE_MAX_ENTRY_BYTES) {
      // uncacheable (no version, or over the entry cap) — still honor the
      // deadline via a transient buffer; only a deadline-less caller (write
      // paths) streams straight through
      if (deadline !== undefined) {
        yield* iteratePartRows(key, Readable.from(await this.downloadWithDeadline(key, deadline)));
      } else {
        yield* this.iterateRows(key);
      }
      return;
    }
    const cacheKey = `${key}@${version.etag}`;
    const cached = this.partCache.get(cacheKey);
    if (cached) {
      // refresh LRU position
      this.partCache.delete(cacheKey);
      this.partCache.set(cacheKey, cached);
      yield* iteratePartRows(key, Readable.from(cached));
      return;
    }
    const buffer = await this.downloadWithDeadline(key, deadline);
    this.cachePart(cacheKey, buffer);
    yield* iteratePartRows(key, Readable.from(buffer));
  }

  private async downloadWithDeadline(key: string, deadline?: number): Promise<Buffer> {
    const stream = await this.storageAdapter.downloadFile(this.bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      if (deadline !== undefined && Date.now() > deadline) {
        stream.destroy();
        throw new ColdReadDeadlineError(`download of ${key} exceeded the cold read budget`);
      }
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  private cachePart(cacheKey: string, buffer: Buffer) {
    if (buffer.length > PART_CACHE_MAX_ENTRY_BYTES) return;
    // two requests can miss the same key concurrently and both land here;
    // replacing without reclaiming the first entry's bytes would inflate
    // the counter with phantom bytes and evict the rest of the cache early
    const existing = this.partCache.get(cacheKey);
    if (existing) {
      this.partCacheBytes -= existing.length;
      this.partCache.delete(cacheKey);
    }
    this.partCache.set(cacheKey, buffer);
    this.partCacheBytes += buffer.length;
    while (this.partCacheBytes > PART_CACHE_MAX_TOTAL_BYTES && this.partCache.size > 0) {
      const oldest = this.partCache.keys().next().value as string;
      const evicted = this.partCache.get(oldest);
      this.partCache.delete(oldest);
      this.partCacheBytes -= evicted?.length ?? 0;
    }
  }

  async deleteKeys(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.storageAdapter.deleteFile(this.bucket, key);
    }
  }

  /** remove the whole cold prefix of a table (table permanent deletion) */
  async deleteTablePrefix(tableId: string): Promise<void> {
    const prefix = tablePrefix(this.rootDir, tableId).replace(/\/$/, '');
    await this.storageAdapter.deleteDir(this.bucket, prefix, false);
  }
}
