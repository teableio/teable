import type { Readable } from 'node:stream';
import type { IRecordBloom } from '../cold-archive/bloom';
import type { IPartBucket } from '../cold-archive/bucket';
import { padSeq } from '../cold-archive/bucket';
import { createPartCompressorFor, partFileSuffixFor } from '../cold-archive/compression';
import { decodePartRows } from '../cold-archive/part-line';

/**
 * Cold-part layout (see record-history-cold-storage-plan.md):
 *
 *   record-history/v1/{tableId}/{yyyymm}/{dd}-p{seq}-{minRecordId}.ndjson.zst   flusher day part
 *   record-history/v1/{tableId}/{yyyymm}/m-p{seq}-{minRecordId}.ndjson.zst     compactor month part
 *   record-history/v1/{tableId}/_stats.json                                     per-table pruning stats
 *
 * A part is NDJSON: one header line, N data rows, one footer line, compressed
 * as a single zstd (or gzip fallback) stream. Rows inside a part are sorted by
 * (recordId, createdTime, id).
 */

export { iterateNdjsonLines } from '../cold-archive/ndjson';
export { bloomMightContain, buildRecordBloom } from '../cold-archive/bloom';
export { bucketId, bucketOfDate } from '../cold-archive/bucket';
export type { IPartBucket } from '../cold-archive/bucket';
export { createRowHasher, serializeFooter } from '../cold-archive/part-line';
export type { IPartFooter } from '../cold-archive/part-line';

export const RECORD_HISTORY_COLD_VERSION = 'v1';

export interface IColdHistoryRow {
  id: string;
  recordId: string;
  fieldId: string;
  /** raw JSON text exactly as stored in record_history.before */
  before: string;
  /** raw JSON text exactly as stored in record_history.after */
  after: string;
  /** ISO string */
  createdTime: string;
  createdBy: string;
}

export interface IPartHeader {
  t: 'h';
  v: 1;
  tableId: string;
  bucket: IPartBucket;
}

export interface IParsedPartKey extends IPartBucket {
  tableId: string;
  seq: number;
  minRecordId: string;
  // distinct tokens = distinct write generations; absent on legacy keys
  runToken?: string;
  compression: 'zstd' | 'gzip';
  key: string;
}

export interface IPartStatsEntry {
  key: string;
  rows: number;
  minCreatedTime: string;
  maxCreatedTime: string;
  minRecordId: string;
  maxRecordId: string;
  /** distinct field ids in the part; null when over the cap (must scan) */
  fieldIds: string[] | null;
  /** distinct creators in the part; null when over the cap (must scan) */
  createdBys: string[] | null;
  /** record-id bloom filter: "definitely not here" prunes the part safely */
  recordBloom?: IRecordBloom;
}

export interface ITableColdStats {
  version: 1;
  tableId: string;
  parts: Record<string, IPartStatsEntry>;
}

/**
 * explicit-set cap for per-part fieldIds/createdBys in `_stats.json`; beyond
 * this the set is stored as null (= must scan). 500 is the product's column
 * maximum, so the fieldIds set never degrades — field pruning always works.
 * Worst case ≈ 10KB per part entry, and only for parts that actually touch
 * that many distinct fields/actors.
 */
export const STATS_SET_CAP = 500;

const COLD_COMPRESSION_ENV = 'BACKEND_RECORD_HISTORY_COLD_COMPRESSION';

export const partFileSuffix = () => partFileSuffixFor(COLD_COMPRESSION_ENV);

export const createPartCompressor = () => createPartCompressorFor(COLD_COMPRESSION_ENV);

export const coldRootDir = (rootDir: string) => `${rootDir}/${RECORD_HISTORY_COLD_VERSION}`;

export const tablePrefix = (rootDir: string, tableId: string) =>
  `${coldRootDir(rootDir)}/${tableId}/`;

export const monthPrefix = (rootDir: string, tableId: string, yyyymm: string) =>
  `${tablePrefix(rootDir, tableId)}${yyyymm}/`;

export const statsKey = (rootDir: string, tableId: string) =>
  `${tablePrefix(rootDir, tableId)}_stats.json`;

export const buildPartKey = (
  rootDir: string,
  tableId: string,
  bucket: IPartBucket,
  seq: number,
  minRecordId: string,
  runToken?: string
) => {
  const base = monthPrefix(rootDir, tableId, bucket.yyyymm);
  const lead = bucket.kind === 'month' ? 'm' : bucket.dd!;
  // the run token makes concurrent rewrites of the same bucket collision-free:
  // two runs computing the same startSeq from the same listing still produce
  // distinct keys, so neither can overwrite (or verification-cleanup-delete)
  // the other's part; read-side id-dedup absorbs the duplication
  const run = runToken ? `r${runToken}-` : '';
  return `${base}${lead}-p${padSeq(seq)}-${run}${minRecordId}${partFileSuffix()}`;
};

// filename: {m|dd}-p{seq}-[r{runToken}-]{minRecordId}.ndjson.{zst|gz}
// (the run token was added later; keys without one still parse)
const PART_FILE_RE = /^(m|\d{2})-p(\d+)-(?:r([a-z0-9]+)-)?(.+)\.ndjson\.(zst|gz)$/;

export const parsePartKey = (rootDir: string, key: string): IParsedPartKey | undefined => {
  const root = coldRootDir(rootDir);
  if (!key.startsWith(`${root}/`)) return undefined;
  const rest = key.slice(root.length + 1);
  const segments = rest.split('/');
  if (segments.length !== 3) return undefined;
  const [tableId, yyyymm, fileName] = segments;
  if (!/^\d{6}$/.test(yyyymm)) return undefined;
  const match = PART_FILE_RE.exec(fileName);
  if (!match) return undefined;
  const [, lead, seq, runToken, minRecordId, compression] = match;
  return {
    tableId,
    yyyymm,
    kind: lead === 'm' ? 'month' : 'day',
    dd: lead === 'm' ? undefined : lead,
    seq: Number(seq),
    minRecordId,
    runToken,
    compression: compression === 'zst' ? 'zstd' : 'gzip',
    key,
  };
};

export const serializeHeader = (tableId: string, bucket: IPartBucket): string =>
  JSON.stringify({ t: 'h', v: 1, tableId, bucket } satisfies IPartHeader);

export const serializeRow = (row: IColdHistoryRow): string => JSON.stringify(row);

/**
 * A stored before/after over `maxUnits` is a legacy anomaly: values this large
 * (up to 15MB on the ai fleet) make the cold flush/merge OOM no matter how the
 * memory is bounded, so they are replaced with a compact marker at every point
 * a row enters the sorter, so the pipeline never holds a multi-MB value.
 *
 * `maxUnits` is measured against the WHOLE before/after JSON (the `{meta,data}`
 * history envelope, in UTF-16 units — O(1), the proxy for the V8 heap cost that
 * OOMs), not just the cell value. A valid cell caps at
 * TABLE_LIMIT_CELL_VALUE_MAX_BYTES of `data`; the default threshold sits well
 * above that envelope so a legitimately max-size value is never truncated.
 *
 * The marker keeps the `{meta?,data}` shape (a non-nullish `data` string) so
 * getRecordHistory renders "value truncated" instead of a blank cell, and
 * carries `coldTruncated`/`units` for programmatic detection.
 */
/** marker for a value replaced because it exceeded the cap; matches the SQL read-path form in readBatch */
export const coldTruncatedMarker = (units: number): string =>
  `{"data":"[value too large, cold-truncated (${units} chars)]","coldTruncated":true,"units":${units}}`;

export const truncateColdValue = (raw: string, maxUnits: number): string =>
  maxUnits > 0 && raw.length > maxUnits ? coldTruncatedMarker(raw.length) : raw;

/** truncate a row's before/after in place-free fashion; returns the same ref when nothing changed (incl. maxUnits<=0 = disabled) */
export const truncateColdRow = (row: IColdHistoryRow, maxUnits: number): IColdHistoryRow => {
  if (maxUnits <= 0 || (row.before.length <= maxUnits && row.after.length <= maxUnits)) return row;
  return {
    ...row,
    before: truncateColdValue(row.before, maxUnits),
    after: truncateColdValue(row.after, maxUnits),
  };
};

export const iteratePartRows = (key: string, compressed: Readable) =>
  decodePartRows<IColdHistoryRow>(key, compressed);

export const compareRowAsc = (
  a: Pick<IColdHistoryRow, 'recordId' | 'createdTime' | 'id'>,
  b: Pick<IColdHistoryRow, 'recordId' | 'createdTime' | 'id'>
) => {
  if (a.recordId !== b.recordId) return a.recordId < b.recordId ? -1 : 1;
  if (a.createdTime !== b.createdTime) return a.createdTime < b.createdTime ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
};

/** descending (createdTime, id) — the merged read order of record history */
export const compareRowByTimeDesc = (
  a: Pick<IColdHistoryRow, 'createdTime' | 'id'>,
  b: Pick<IColdHistoryRow, 'createdTime' | 'id'>
) => {
  if (a.createdTime !== b.createdTime) return a.createdTime < b.createdTime ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
};
