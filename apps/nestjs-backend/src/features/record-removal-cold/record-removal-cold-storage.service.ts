import { Injectable, Logger } from '@nestjs/common';
import { UploadType } from '@teable/openapi';
import StorageAdapter from '../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../attachments/plugins/storage';
import { coldStorageRead } from '../cold-archive/cold-errors';
import { ColdPartByteCache } from '../cold-archive/part-byte-cache';
import { ColdStatsCache } from '../cold-archive/stats-cache';
import {
  deleteColdKeys,
  listMonthDirs,
  partStoreFor,
  readColdStats,
  readColdStatsCached,
  writeColdStats,
} from '../cold-archive/storage-ops';
import type {
  ColdRemovalReason,
  IColdRemovalRow,
  IParsedPartKey,
  IPartFooter,
  ITableColdStats,
} from './part-codec';
import {
  coldRootDir,
  iteratePartRows,
  monthPrefix,
  parsePartKey,
  reasonPrefix,
  statsKey,
  tablePrefix,
} from './part-codec';
import type { IPartStore } from './part-writer';

const DELETE_CONCURRENCY = 8;

export { ColdReadDeadlineError, ColdStorageUnavailableError } from '../cold-archive/cold-errors';

// Storage facade for record-removal cold parts on the private bucket:
// key listing (per tableId+reason, two-level: month prefixes → parts of a
// month), `_stats.json` maintenance, and prefix deletion for table purges.
//
// Listings/downloads used by the WRITE paths are cache-free: parts are
// rewritten by the flusher/compactor running in another process, so a
// key-addressed byte cache can serve clobbered content. The READ path may
// use `iterateRowsCached`, which is keyed by key@etag from a live listing —
// a rewrite changes the etag and misses the cache by construction.
@Injectable()
export class RecordRemovalColdStorageService {
  private readonly logger = new Logger(RecordRemovalColdStorageService.name);
  private readonly statsCache = new ColdStatsCache();
  private readonly partCache = new ColdPartByteCache((key) =>
    coldStorageRead(() => this.storageAdapter.downloadFile(this.bucket, key))
  );

  constructor(@InjectStorageAdapter() private readonly storageAdapter: StorageAdapter) {}

  get bucket(): string {
    return StorageAdapter.getBucket(UploadType.RecordRemoval);
  }

  get rootDir(): string {
    return StorageAdapter.getDir(UploadType.RecordRemoval);
  }

  // the minimal store surface used by PartWriter (upload + verify + cleanup)
  get partStore(): IPartStore {
    return partStoreFor(this.storageAdapter, this.bucket);
  }

  // every table that has cold data (top-level prefixes under the version
  // root); the reasons under a table are not listed — COLD_REMOVAL_REASONS is
  // a closed set, callers enumerate it
  async listTables(): Promise<string[]> {
    const { prefixes } = await coldStorageRead(() =>
      this.storageAdapter.listObjects(this.bucket, `${coldRootDir(this.rootDir)}/`, {
        delimiter: '/',
      })
    );
    return prefixes
      .map((prefix) => /\/(tbl[A-Za-z0-9]+)\/$/.exec(prefix)?.[1])
      .filter((tableId): tableId is string => Boolean(tableId));
  }

  // always a live LIST: the flusher/compactor run in a different process
  // than the readers, so any cross-request cache here would hide a freshly
  // created month dir (right after its buffer rows were deleted). Reads only
  // reach S3 when the buffer cannot fill the page, so the LIST is rare.
  async listMonths(tableId: string, reason: ColdRemovalReason): Promise<string[]> {
    return listMonthDirs(
      this.storageAdapter,
      this.bucket,
      reasonPrefix(this.rootDir, tableId, reason)
    );
  }

  async listMonthParts(
    tableId: string,
    reason: ColdRemovalReason,
    yyyymm: string
  ): Promise<Array<IParsedPartKey & { size: number; etag?: string }>> {
    const { objects } = await coldStorageRead(() =>
      this.storageAdapter.listObjects(
        this.bucket,
        monthPrefix(this.rootDir, tableId, reason, yyyymm)
      )
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

  // maintenance-path variant: only a missing shard reads as undefined, a
  // failed read throws — a rewrite built on a failed read would clobber the shard
  async readStats(
    tableId: string,
    reason: ColdRemovalReason
  ): Promise<ITableColdStats | undefined> {
    return readColdStats<ITableColdStats>(
      this.storageAdapter,
      this.bucket,
      statsKey(this.rootDir, tableId, reason)
    );
  }

  // read-path variant: etag-keyed cache, so a request that needs stats for a
  // count, a boundary and a scan downloads them once
  async readStatsCached(
    tableId: string,
    reason: ColdRemovalReason
  ): Promise<ITableColdStats | undefined> {
    return readColdStatsCached<ITableColdStats>(
      this.storageAdapter,
      this.bucket,
      statsKey(this.rootDir, tableId, reason),
      this.statsCache,
      (why) =>
        this.logger.debug(`no readable cold stats for table ${tableId} reason ${reason}: ${why}`)
    );
  }

  async writeStats(
    tableId: string,
    reason: ColdRemovalReason,
    stats: ITableColdStats
  ): Promise<void> {
    await writeColdStats(
      this.storageAdapter,
      this.bucket,
      statsKey(this.rootDir, tableId, reason),
      stats
    );
  }

  // stream-decode a part's rows straight off the storage stream
  async *iterateRows(
    key: string
  ): AsyncGenerator<{ row?: IColdRemovalRow; footer?: IPartFooter; rowLine?: string }> {
    const stream = await this.storageAdapter.downloadFile(this.bucket, key);
    yield* iteratePartRows(key, stream);
  }

  // read-path variant with an etag-keyed LRU of compressed bytes: paging
  // over the same parts skips repeated downloads, and an in-place rewrite
  // (new etag from the live listing) misses the cache by construction.
  // The optional deadline also bounds the buffering download itself — a
  // slow GET would otherwise run to completion before the caller's
  // per-row deadline checks ever see a byte.
  async *iterateRowsCached(
    key: string,
    version: { etag?: string; size?: number },
    deadline?: number
  ): AsyncGenerator<{ row?: IColdRemovalRow; footer?: IPartFooter; rowLine?: string }> {
    yield* iteratePartRows(key, await this.partCache.streamFor(key, version, deadline));
  }

  async deleteKeys(keys: string[]): Promise<void> {
    await deleteColdKeys(this.storageAdapter, this.bucket, keys, DELETE_CONCURRENCY);
  }

  // remove the whole cold prefix of a table — BOTH reason subtrees at once
  // (table permanent deletion)
  async deleteTablePrefix(tableId: string): Promise<void> {
    const prefix = tablePrefix(this.rootDir, tableId).replace(/\/$/, '');
    await this.storageAdapter.deleteDir(this.bucket, prefix, false);
  }

  // remove ONE reason subtree of a table, parts and _stats.json alike (e.g.
  // an archive reset drains PG then wipes archived/ while deleted/ stays);
  // full-table purges keep using deleteTablePrefix for both reasons at once.
  // Failures must propagate: resets rely on the prefix being gone (no
  // tombstones), so a swallowed error resurfaces cold rows as ghosts.
  async deleteReasonPrefix(tableId: string, reason: ColdRemovalReason): Promise<void> {
    const prefix = reasonPrefix(this.rootDir, tableId, reason).replace(/\/$/, '');
    await this.storageAdapter.deleteDir(this.bucket, prefix);
  }
}
