import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import * as zlib from 'node:zlib';

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

export interface IPartBucket {
  yyyymm: string;
  kind: 'day' | 'month';
  /** two digit day, only for kind=day */
  dd?: string;
}

export interface IPartHeader {
  t: 'h';
  v: 1;
  tableId: string;
  bucket: IPartBucket;
}

export interface IPartFooter {
  t: 'f';
  rows: number;
  sha256: string;
}

export interface IParsedPartKey extends IPartBucket {
  tableId: string;
  seq: number;
  minRecordId: string;
  compression: 'zstd' | 'gzip';
  key: string;
}

export interface IRecordBloom {
  /** bit count */
  m: number;
  /** hash count */
  k: number;
  /** base64 bit array */
  b64: string;
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

const zlibWithZstd = zlib as typeof zlib & {
  createZstdCompress?: (options?: unknown) => zlib.Gzip;
  createZstdDecompress?: (options?: unknown) => zlib.Gunzip;
};

export const hasZstd = typeof zlibWithZstd.createZstdCompress === 'function';

/**
 * Writing prefers zstd when the runtime has it (node >= 22.15). Reading
 * always handles both formats, but a `.zst` KEY needs a zstd-capable reader —
 * on a fleet with mixed node versions (engines allow >= 22.0), force gzip
 * with BACKEND_RECORD_HISTORY_COLD_COMPRESSION=gzip so every process can
 * read freshly written parts. Checked per call: env files may load after
 * module evaluation.
 */
const writeZstd = () => hasZstd && process.env.BACKEND_RECORD_HISTORY_COLD_COMPRESSION !== 'gzip';

export const partFileSuffix = () => (writeZstd() ? '.ndjson.zst' : '.ndjson.gz');

export const createPartCompressor = () => {
  if (writeZstd()) {
    return zlibWithZstd.createZstdCompress!({
      params: {
        [zlib.constants.ZSTD_c_compressionLevel]: 3,
      },
    });
  }
  return zlib.createGzip({ level: 6 });
};

export const createPartDecompressor = (key: string) => {
  if (key.endsWith('.zst')) {
    if (!hasZstd) {
      throw new Error(`cannot decompress ${key}: node runtime lacks zstd support`);
    }
    return zlibWithZstd.createZstdDecompress!();
  }
  return zlib.createGunzip();
};

export const coldRootDir = (rootDir: string) => `${rootDir}/${RECORD_HISTORY_COLD_VERSION}`;

export const tablePrefix = (rootDir: string, tableId: string) =>
  `${coldRootDir(rootDir)}/${tableId}/`;

export const monthPrefix = (rootDir: string, tableId: string, yyyymm: string) =>
  `${tablePrefix(rootDir, tableId)}${yyyymm}/`;

export const statsKey = (rootDir: string, tableId: string) =>
  `${tablePrefix(rootDir, tableId)}_stats.json`;

const padSeq = (seq: number) => String(seq).padStart(4, '0');

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
const PART_FILE_RE = /^(m|\d{2})-p(\d+)-(?:r[a-z0-9]+-)?(.+)\.ndjson\.(zst|gz)$/;

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
  const [, lead, seq, minRecordId, compression] = match;
  return {
    tableId,
    yyyymm,
    kind: lead === 'm' ? 'month' : 'day',
    dd: lead === 'm' ? undefined : lead,
    seq: Number(seq),
    minRecordId,
    compression: compression === 'zst' ? 'zstd' : 'gzip',
    key,
  };
};

export const bucketOfDate = (date: Date, kind: 'day' | 'month'): IPartBucket => {
  const yyyymm = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  if (kind === 'month') return { yyyymm, kind };
  return { yyyymm, kind, dd: String(date.getUTCDate()).padStart(2, '0') };
};

export const bucketId = (bucket: IPartBucket) =>
  bucket.kind === 'month' ? `${bucket.yyyymm}/m` : `${bucket.yyyymm}/${bucket.dd}`;

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

export const serializeFooter = (rows: number, sha256: string): string =>
  JSON.stringify({ t: 'f', rows, sha256 } satisfies IPartFooter);

export const createRowHasher = () => {
  const hash = createHash('sha256');
  return {
    update(rowLine: string) {
      hash.update(rowLine);
      hash.update('\n');
    },
    digest() {
      return hash.digest('hex');
    },
  };
};

export interface IParsedPartLine {
  header?: IPartHeader;
  footer?: IPartFooter;
  row?: IColdHistoryRow;
  raw: string;
}

export const parsePartLine = (line: string): IParsedPartLine | undefined => {
  if (!line) return undefined;
  const value = JSON.parse(line) as { t?: string };
  if (value.t === 'h') return { header: value as IPartHeader, raw: line };
  if (value.t === 'f') return { footer: value as IPartFooter, raw: line };
  return { row: value as unknown as IColdHistoryRow, raw: line };
};

const NEWLINE = 0x0a;

/**
 * Split a byte stream into NDJSON line strings WITHOUT node:readline.
 *
 * readline flattens its growing internal ConsString and runs a line-ending
 * regex on every chunk, so a single multi-megabyte line (a history row whose
 * before/after JSON is tens of MB — real on the ai fleet, up to 15MB) becomes
 * an O(n^2) rope-flatten storm that OOM'd the 2026-07-08 cold drain
 * (RegExpImpl::IrregexpExec / String::SlowFlatten at the top of the abort
 * stack). Here partial-line chunks accumulate in an array and concatenate
 * exactly once, when the newline arrives — O(total bytes), one allocation per
 * line, no regex.
 */
export async function* iterateNdjsonLines(stream: Readable): AsyncGenerator<string> {
  const pending: Buffer[] = [];
  let pendingLen = 0;
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      let start = 0;
      let nl = chunk.indexOf(NEWLINE, start);
      while (nl !== -1) {
        const slice = chunk.subarray(start, nl);
        let line: Buffer;
        if (pendingLen > 0) {
          pending.push(slice);
          line = Buffer.concat(pending, pendingLen + slice.length);
          pending.length = 0;
          pendingLen = 0;
        } else {
          line = slice;
        }
        if (line.length > 0) yield line.toString('utf8');
        start = nl + 1;
        nl = chunk.indexOf(NEWLINE, start);
      }
      if (start < chunk.length) {
        // copy: the source buffer may be recycled before the next iteration
        const rest = Buffer.from(chunk.subarray(start));
        pending.push(rest);
        pendingLen += rest.length;
      }
    }
    if (pendingLen > 0) {
      const line = Buffer.concat(pending, pendingLen).toString('utf8');
      if (line.length > 0) yield line;
    }
  } finally {
    stream.destroy();
  }
}

/**
 * Stream-decode a compressed part into rows. Memory stays O(line): download
 * stream → decompressor → NDJSON line splitter. The caller may stop early by
 * breaking out of the async iterator.
 */
export async function* iteratePartRows(
  key: string,
  compressed: Readable
): AsyncGenerator<{ row?: IColdHistoryRow; footer?: IPartFooter; rowLine?: string }> {
  const decompressor = createPartDecompressor(key);
  // decode failures must name the part; a bare zlib error is undebuggable
  decompressor.on('error', (error: Error & { partKey?: string }) => {
    error.partKey = key;
    error.message = `${error.message} (part ${key})`;
  });
  try {
    for await (const line of iterateNdjsonLines(compressed.pipe(decompressor))) {
      const parsed = parsePartLine(line);
      if (!parsed) continue;
      if (parsed.header) continue;
      if (parsed.footer) {
        yield { footer: parsed.footer };
        continue;
      }
      yield { row: parsed.row, rowLine: parsed.raw };
    }
  } finally {
    compressed.destroy();
  }
}

export const compareRowAsc = (
  a: Pick<IColdHistoryRow, 'recordId' | 'createdTime' | 'id'>,
  b: Pick<IColdHistoryRow, 'recordId' | 'createdTime' | 'id'>
) => {
  if (a.recordId !== b.recordId) return a.recordId < b.recordId ? -1 : 1;
  if (a.createdTime !== b.createdTime) return a.createdTime < b.createdTime ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
};

/* ------------------------------------------------------------------ *
 * record-id bloom filter (double hashing, ~1% target false positives) *
 * ------------------------------------------------------------------ */

const BLOOM_BITS_PER_ELEMENT = 10; // ≈0.8% fpr with k=7
const BLOOM_HASHES = 7;
const BLOOM_MIN_BITS = 64;

const fnv1a = (value: string, seed: number): number => {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

const bloomBitPositions = (value: string, m: number, k: number): number[] => {
  const h1 = fnv1a(value, 0);
  // odd step so all bits stay reachable; `| 1` alone would coerce to a SIGNED
  // 32-bit int (negative for hashes ≥ 2^31), making the modulo negative and
  // the buffer write a silent out-of-range no-op — a false-negative factory
  const h2 = (fnv1a(value, 0x9e3779b9) | 1) >>> 0;
  const positions: number[] = [];
  for (let i = 0; i < k; i++) {
    // both operands are non-negative and well under 2^53, so % stays in [0, m)
    positions.push((h1 + i * h2) % m);
  }
  return positions;
};

/** build a bloom over the part's distinct record ids */
export const buildRecordBloom = (recordIds: Iterable<string>, count: number): IRecordBloom => {
  const m = Math.max(BLOOM_MIN_BITS, Math.ceil(count * BLOOM_BITS_PER_ELEMENT));
  const bytes = Buffer.alloc(Math.ceil(m / 8));
  for (const recordId of recordIds) {
    for (const position of bloomBitPositions(recordId, m, BLOOM_HASHES)) {
      bytes[position >> 3] |= 1 << (position & 7);
    }
  }
  return { m, k: BLOOM_HASHES, b64: bytes.toString('base64') };
};

/** false only when the record is DEFINITELY absent — safe to prune on false */
export const bloomMightContain = (bloom: IRecordBloom, recordId: string): boolean => {
  const bytes = Buffer.from(bloom.b64, 'base64');
  for (const position of bloomBitPositions(recordId, bloom.m, bloom.k)) {
    if ((bytes[position >> 3] & (1 << (position & 7))) === 0) return false;
  }
  return true;
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
