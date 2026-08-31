import { Readable } from 'node:stream';
import { mapWithConcurrency } from '../../utils/map-with-concurrency';
import type StorageAdapter from '../attachments/plugins/adapter';
import { coldStorageRead, isMissingPartError } from './cold-errors';
import type { ColdStatsCache } from './stats-cache';

// Bucket-level plumbing shared by every cold subsystem's storage facade. These
// are free functions rather than a base class on purpose: each subsystem's
// public surface is scoped differently (audit keys by month, the record/run
// subsystems by table/workflow), so only the bodies are common — a base class
// would have to make the scope a type parameter and fight Nest DI for nothing.

const NDJSON_CONTENT_TYPE = 'application/x-ndjson';
const JSON_CONTENT_TYPE = 'application/json';

/** the minimal store surface PartWriter needs (upload + verify + cleanup) */
export const partStoreFor = (adapter: StorageAdapter, bucket: string) => ({
  upload: async (key: string, stream: Readable) => {
    await adapter.uploadFileStream(bucket, key, stream, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': NDJSON_CONTENT_TYPE,
    });
  },
  download: (key: string) => adapter.downloadFile(bucket, key),
  delete: async (key: string) => {
    await adapter.deleteFile(bucket, key);
  },
});

/**
 * Only a genuinely missing object reads as empty; a failed download, corrupt
 * JSON or unknown version throws. Maintenance paths rely on this: degrading
 * to undefined would let a read-modify-write rebuild the shard from scratch,
 * permanently dropping every entry and checkpoint the run did not touch.
 */
export const readColdStats = async <TStats extends { version: number }>(
  adapter: StorageAdapter,
  bucket: string,
  key: string
): Promise<TStats | undefined> => {
  let parsed: TStats;
  try {
    const stream = await adapter.downloadFile(bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as TStats;
  } catch (error) {
    if (isMissingPartError(error)) return undefined;
    throw error;
  }
  if (parsed.version !== 1) {
    throw new Error(`unsupported cold stats version ${parsed.version} at ${key}`);
  }
  return parsed;
};

/**
 * Serving-path variant: stats are ADVISORY there, so any read failure
 * degrades to part scans (undefined) instead of failing the request.
 * Resolves the object's etag with a LIST of the single stats key and serves
 * a parsed hit from the cache. WRITE paths must keep using readColdStats —
 * they read stats in order to rewrite them, which is exactly what an etag
 * cache cannot make safe.
 *
 * Callers that already hold a fresh etag (they just listed the month) pass it
 * and skip the LIST.
 */
export const readColdStatsCached = async <TStats extends { version: number }>(
  adapter: StorageAdapter,
  bucket: string,
  key: string,
  cache: ColdStatsCache,
  onMiss: (reason: string) => void,
  knownEtag?: string
): Promise<TStats | undefined> => {
  let etag = knownEtag;
  if (etag === undefined) {
    try {
      const { objects } = await adapter.listObjects(bucket, key);
      etag = objects.find((object) => object.key === key)?.etag;
    } catch {
      // a failed LIST only costs the cache; the download below still decides
      etag = undefined;
    }
  }
  const hit = cache.get<TStats>(key, etag);
  if (hit) return hit;
  let parsed: TStats | undefined;
  try {
    parsed = await readColdStats<TStats>(adapter, bucket, key);
  } catch (error) {
    onMiss(error instanceof Error ? error.message : String(error));
    return undefined;
  }
  if (parsed) cache.set(key, etag, parsed);
  return parsed;
};

export const writeColdStats = async (
  adapter: StorageAdapter,
  bucket: string,
  key: string,
  stats: unknown
): Promise<void> => {
  const body = Buffer.from(JSON.stringify(stats));
  await adapter.uploadFileStream(bucket, key, Readable.from(body), {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'Content-Type': JSON_CONTENT_TYPE,
  });
};

/**
 * Month directories under a version root. Always a live LIST: a cross-request
 * cache would hide a freshly created month dir right after its buffer rows
 * were deleted. Newest first — every read walks backwards in time.
 */
export const listMonthDirs = async (
  adapter: StorageAdapter,
  bucket: string,
  rootPrefix: string
): Promise<string[]> => {
  // unlike stats this cannot degrade — a swallowed failure reads as an empty cold zone
  const { prefixes } = await coldStorageRead(() =>
    adapter.listObjects(bucket, rootPrefix, { delimiter: '/' })
  );
  return prefixes
    .map((prefix) => /\/(\d{6})\/$/.exec(prefix)?.[1])
    .filter((month): month is string => Boolean(month))
    .sort()
    .reverse();
};

/**
 * `concurrency` is explicit rather than defaulted: the subsystems genuinely
 * differ (record-history deletes serially, the others fan out), and hiding
 * that behind a default would silently change one of them.
 */
export const deleteColdKeys = async (
  adapter: StorageAdapter,
  bucket: string,
  keys: string[],
  concurrency: number
): Promise<void> => {
  await mapWithConcurrency(keys, concurrency, (key) => adapter.deleteFile(bucket, key));
};
