import type { Readable } from 'node:stream';
import type { IRecordBloom } from '../cold-archive/bloom';
import type { IPartBucket } from '../cold-archive/bucket';
import { padSeq } from '../cold-archive/bucket';
import { createPartCompressorFor, partFileSuffixFor } from '../cold-archive/compression';
import { decodePartRows } from '../cold-archive/part-line';

// Cold-part layout (see record-removal-cold p3 design):
//
//   record-removal/v1/{tableId}/{reason}/{yyyymm}/{dd}-p{seq}-r{runToken}.ndjson.zst  flusher day part
//   record-removal/v1/{tableId}/{reason}/{yyyymm}/m-p{seq}-r{runToken}.ndjson.zst     compactor month part
//   record-removal/v1/{tableId}/{reason}/_stats.json                                  per-(table,reason) pruning stats
//
// A part is NDJSON: one header line, N data rows, one footer line, compressed
// as a single zstd (or gzip fallback) stream. Rows inside a part are sorted by
// (removedTime DESC, id DESC) — the archive default page order, so a reader
// stops as soon as its page is full. Unlike record history there is no
// minRecordId in the key: record-id point queries prune via the per-part bloom
// in `_stats.json` instead.

export { iterateNdjsonLines } from '../cold-archive/ndjson';
export { bloomMightContain, buildRecordBloom } from '../cold-archive/bloom';
export { bucketId, bucketOfDate } from '../cold-archive/bucket';
export type { IPartBucket } from '../cold-archive/bucket';
export { createRowHasher, serializeFooter } from '../cold-archive/part-line';
export type { IPartFooter } from '../cold-archive/part-line';

export const RECORD_REMOVAL_COLD_VERSION = 'v1';

// the removal reasons are key-path segments — a frozen storage contract. They
// mirror IRecordRemovalReason (@teable/v2-core) by value, but deliberately do
// NOT derive from it: a domain-type change must never silently reshape keys.
export const COLD_REMOVAL_REASONS = ['deleted', 'archived'] as const;

export type ColdRemovalReason = (typeof COLD_REMOVAL_REASONS)[number];

export const isColdRemovalReason = (value: string): value is ColdRemovalReason =>
  (COLD_REMOVAL_REASONS as readonly string[]).includes(value);

export interface IColdRemovalRow {
  id: string;
  recordId: string;
  // record snapshot JSON text as stored in record_trash.snapshot, after
  // truncateRemovalRow — never the raw form (see the truncation section below)
  snapshot: string;
  reason: ColdRemovalReason;
  // ISO string (= record_trash.created_time, the moment of removal)
  removedTime: string;
  removedBy: string;
  operationId?: string;
  recordCreatedTime?: string;
  recordCreatedBy?: string;
  recordLastModifiedTime?: string;
  recordLastModifiedBy?: string;
}

export interface IPartHeader {
  t: 'h';
  v: 1;
  tableId: string;
  reason: ColdRemovalReason;
  bucket: IPartBucket;
}

export interface IParsedPartKey extends IPartBucket {
  tableId: string;
  reason: ColdRemovalReason;
  seq: number;
  // distinct tokens = distinct write generations
  runToken: string;
  compression: 'zstd' | 'gzip';
  key: string;
}

export interface IPartStatsEntry {
  key: string;
  rows: number;
  sha256: string;
  minRemovedTime: string;
  maxRemovedTime: string;
  // the record-meta dims are optional on the row, so their bounds/sets cover
  // only rows that carry them — pruning on these dims only skips rows a
  // dim-equality filter could never match anyway
  minRecordCreatedTime?: string;
  maxRecordCreatedTime?: string;
  minRecordLastModifiedTime?: string;
  maxRecordLastModifiedTime?: string;
  // distinct record creators in the part; null when over the cap (must scan)
  recordCreatedBys: string[] | null;
  // distinct last modifiers in the part; null when over the cap (must scan)
  recordLastModifiedBys: string[] | null;
  // record-id bloom filter: "definitely not here" prunes the part safely
  recordBloom?: IRecordBloom;
}

export interface ITableColdStats {
  version: 1;
  tableId: string;
  reason: ColdRemovalReason;
  parts: Record<string, IPartStatsEntry>;
}

// explicit-set cap for per-part recordCreatedBys/recordLastModifiedBys in
// `_stats.json`; beyond this the set is stored as null (= must scan). 500
// matches the record-history stats cap: worst case ≈ 10KB per part entry, and
// only for parts that actually touch that many distinct actors.
export const STATS_SET_CAP = 500;

const COLD_COMPRESSION_ENV = 'BACKEND_RECORD_REMOVAL_COLD_COMPRESSION';

export const partFileSuffix = () => partFileSuffixFor(COLD_COMPRESSION_ENV);

export const createPartCompressor = () => createPartCompressorFor(COLD_COMPRESSION_ENV);

export const coldRootDir = (rootDir: string) => `${rootDir}/${RECORD_REMOVAL_COLD_VERSION}`;

export const tablePrefix = (rootDir: string, tableId: string) =>
  `${coldRootDir(rootDir)}/${tableId}/`;

export const reasonPrefix = (rootDir: string, tableId: string, reason: ColdRemovalReason) =>
  `${tablePrefix(rootDir, tableId)}${reason}/`;

export const monthPrefix = (
  rootDir: string,
  tableId: string,
  reason: ColdRemovalReason,
  yyyymm: string
) => `${reasonPrefix(rootDir, tableId, reason)}${yyyymm}/`;

export const statsKey = (rootDir: string, tableId: string, reason: ColdRemovalReason) =>
  `${reasonPrefix(rootDir, tableId, reason)}_stats.json`;

export const buildPartKey = (
  rootDir: string,
  tableId: string,
  reason: ColdRemovalReason,
  bucket: IPartBucket,
  seq: number,
  runToken: string
) => {
  const base = monthPrefix(rootDir, tableId, reason, bucket.yyyymm);
  const lead = bucket.kind === 'month' ? 'm' : bucket.dd!;
  // the run token makes concurrent rewrites of the same bucket collision-free:
  // two runs computing the same startSeq from the same listing still produce
  // distinct keys, so neither can overwrite (or verification-cleanup-delete)
  // the other's part; read-side id-dedup absorbs the duplication
  return `${base}${lead}-p${padSeq(seq)}-r${runToken}${partFileSuffix()}`;
};

// filename: {m|dd}-p{seq}-r{runToken}.ndjson.{zst|gz}
const PART_FILE_RE = /^(m|\d{2})-p(\d+)-r([a-z0-9]+)\.ndjson\.(zst|gz)$/;

export const parsePartKey = (rootDir: string, key: string): IParsedPartKey | undefined => {
  const root = coldRootDir(rootDir);
  if (!key.startsWith(`${root}/`)) return undefined;
  const rest = key.slice(root.length + 1);
  const segments = rest.split('/');
  if (segments.length !== 4) return undefined;
  const [tableId, reason, yyyymm, fileName] = segments;
  if (!isColdRemovalReason(reason)) return undefined;
  if (!/^\d{6}$/.test(yyyymm)) return undefined;
  const match = PART_FILE_RE.exec(fileName);
  if (!match) return undefined;
  const [, lead, seq, runToken, compression] = match;
  return {
    tableId,
    reason,
    yyyymm,
    kind: lead === 'm' ? 'month' : 'day',
    dd: lead === 'm' ? undefined : lead,
    seq: Number(seq),
    runToken,
    compression: compression === 'zst' ? 'zstd' : 'gzip',
    key,
  };
};

export const serializeHeader = (
  tableId: string,
  reason: ColdRemovalReason,
  bucket: IPartBucket
): string => JSON.stringify({ t: 'h', v: 1, tableId, reason, bucket } satisfies IPartHeader);

export const serializeRow = (row: IColdRemovalRow): string => JSON.stringify(row);

// A snapshot value over the caps is a legacy anomaly: values this large (up to
// 15MB observed on the ai fleet history data) make the cold flush/merge OOM no
// matter how the memory is bounded, so they are replaced with a compact marker
// at every point a row enters the sorter (flusher hot-window read, feeder
// fold-back, compactor) — the pipeline never holds a multi-MB value. Rows
// still inside the PG hot window are untouched, so restores from PG stay full
// fidelity; only the S3 copy is capped.
//
// Both caps are measured in UTF-16 units (O(1), the proxy for the V8 heap
// cost that OOMs): `fieldUnits` against each field VALUE's serialized JSON
// inside the snapshot's `fields` map (the default sits ~16x above the product
// cell-value maximum, so a legitimately max-size cell is never truncated), and
// `rowUnits` against the whole snapshot as a fallback (many capped-but-large
// fields, or an unparseable snapshot). A truncated field restores as empty.
export interface IColdTruncationMarker {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  _truncated: true;
  units: number;
}

// marker replacing an oversized field value (object form) or a whole
// oversized snapshot (its JSON text form); `units` is the size of the
// replaced JSON
export const coldTruncationMarker = (units: number): IColdTruncationMarker => ({
  _truncated: true,
  units,
});

// replace field values over fieldCap inside the snapshot's `fields` map;
// returns undefined when nothing changed — the caller then keeps the ORIGINAL
// string, so an untouched snapshot stays byte-exact (a re-serialize could
// normalize it and break fidelity)
const truncateSnapshotFields = (snapshot: string, fieldCap: number): string | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshot);
  } catch {
    // unparseable snapshot: skip the field pass, the row cap still applies
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const fields = (parsed as { fields?: unknown }).fields;
  if (typeof fields !== 'object' || fields === null) return undefined;
  const fieldMap = fields as Record<string, unknown>;
  let changed = false;
  for (const [fieldId, value] of Object.entries(fieldMap)) {
    if (value === undefined) continue;
    const serialized = JSON.stringify(value);
    if (serialized !== undefined && serialized.length > fieldCap) {
      fieldMap[fieldId] = coldTruncationMarker(serialized.length);
      changed = true;
    }
  }
  return changed ? JSON.stringify(parsed) : undefined;
};

// truncate a row's snapshot in place-free fashion; returns the same ref when
// nothing changed (incl. both caps <= 0 = disabled). The parse only runs for
// rows already over a cap — the fast path skips every normal-sized row.
export const truncateRemovalRow = (
  row: IColdRemovalRow,
  fieldUnits: number,
  rowUnits: number
): IColdRemovalRow => {
  const fieldCap = fieldUnits > 0 ? fieldUnits : Infinity;
  const rowCap = rowUnits > 0 ? rowUnits : Infinity;
  if (row.snapshot.length <= Math.min(fieldCap, rowCap)) return row;
  let snapshot = row.snapshot;
  if (snapshot.length > fieldCap) {
    snapshot = truncateSnapshotFields(snapshot, fieldCap) ?? snapshot;
  }
  if (snapshot.length > rowCap) {
    // whole-snapshot fallback: keep an empty record shell around the marker — the
    // restore paths parse the snapshot itself (v2 reads record.id, v1 iterates
    // record.fields), so a bare marker would fail the whole restore batch
    snapshot = JSON.stringify({
      id: row.recordId,
      fields: {},
      ...coldTruncationMarker(snapshot.length),
    });
  }
  return snapshot === row.snapshot ? row : { ...row, snapshot };
};

export const iteratePartRows = (key: string, compressed: Readable) =>
  decodePartRows<IColdRemovalRow>(key, compressed);

// descending (removedTime, id) — the one canonical order: rows are written
// into parts this way AND merged reads page this way. The id tiebreak is a
// raw UTF-16 code-unit comparison (byte order for these ASCII ids); ordering
// must never cross into a db collation — PG-side reads sort with COLLATE "C"
// so both sides agree on the same total order.
export const compareRemovalRowDesc = (
  a: Pick<IColdRemovalRow, 'removedTime' | 'id'>,
  b: Pick<IColdRemovalRow, 'removedTime' | 'id'>
) => {
  if (a.removedTime !== b.removedTime) return a.removedTime < b.removedTime ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
};
