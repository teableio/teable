/**
 * Bucket-coverage planning for an incremental flush: a bucket whose cold parts
 * already account for exactly the rows PG still holds is skipped, its buffer
 * rows deleted without a rewrite. The check needs BOTH a live key listing and
 * PG's own GROUP BY, because stats alone can name parts a concurrent run has
 * since replaced.
 */

/** per-bucket rollup of a table's `_stats.json` entries */
export interface IBucketStatsAgg {
  keys: Set<string>;
  rows: number;
  min: string;
  max: string;
  // exact (createdTime, id)-max of the bucket's persisted rows — the resume
  // boundary of a partially archived bucket; undefined whenever any entry that
  // could hold the max predates the maxRowId field
  maxRow?: { createdTime: string; id: string };
}

const maxRowOf = (bounds: { max: string; maxRowId?: string }) =>
  bounds.maxRowId ? { createdTime: bounds.max, id: bounds.maxRowId } : undefined;

const mergeMaxRow = (agg: IBucketStatsAgg, bounds: { max: string; maxRowId?: string }): void => {
  if (bounds.max > agg.max) {
    agg.max = bounds.max;
    agg.maxRow = maxRowOf(bounds);
    return;
  }
  if (bounds.max < agg.max) return;
  const entryMaxRow = maxRowOf(bounds);
  // a timestamp tie is unordered unless both sides carry their id
  agg.maxRow =
    agg.maxRow && entryMaxRow
      ? entryMaxRow.id > agg.maxRow.id
        ? entryMaxRow
        : agg.maxRow
      : undefined;
};

/**
 * `bucketIdOfKey` carries the subsystem's key grammar (undefined for a key it
 * cannot parse); `boundsOf` names its timestamp columns.
 */
export const groupStatsByBucket = <TEntry extends { rows: number }>(
  parts: Record<string, TEntry>,
  bucketIdOfKey: (key: string) => string | undefined,
  boundsOf: (entry: TEntry) => { min: string; max: string; maxRowId?: string }
): Map<string, IBucketStatsAgg> => {
  const byBucket = new Map<string, IBucketStatsAgg>();
  for (const [key, entry] of Object.entries(parts)) {
    const id = bucketIdOfKey(key);
    if (id === undefined) continue;
    const bounds = boundsOf(entry);
    let agg = byBucket.get(id);
    if (!agg) {
      agg = {
        keys: new Set<string>(),
        rows: 0,
        min: bounds.min,
        max: bounds.max,
        maxRow: maxRowOf(bounds),
      };
      byBucket.set(id, agg);
    } else {
      if (bounds.min < agg.min) agg.min = bounds.min;
      mergeMaxRow(agg, bounds);
    }
    agg.keys.add(key);
    agg.rows += entry.rows;
  }
  return byBucket;
};

export const isBucketCovered = (
  agg: IBucketStatsAgg | undefined,
  listed: Set<string> | undefined,
  bucket: { count: string; min: Date; max: Date }
): boolean => {
  return (
    agg !== undefined &&
    listed !== undefined &&
    agg.keys.size === listed.size &&
    [...agg.keys].every((key) => listed.has(key)) &&
    agg.rows === Number(bucket.count) &&
    agg.min === bucket.min.toISOString() &&
    agg.max === bucket.max.toISOString()
  );
};

/** canonical time range of a bucket, clamped to the day-window boundary and cutoff */
export const bucketRange = (
  bucket: { yyyymm: string; dd: string | null },
  cutoff: Date,
  dayWindowStart: Date
): { lo: Date; hi: Date } => {
  const year = Number(bucket.yyyymm.slice(0, 4));
  const month = Number(bucket.yyyymm.slice(4, 6));
  if (bucket.dd) {
    const dayStart = new Date(Date.UTC(year, month - 1, Number(bucket.dd)));
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    return {
      lo: dayStart > dayWindowStart ? dayStart : dayWindowStart,
      hi: dayEnd < cutoff ? dayEnd : cutoff,
    };
  }
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const nextMonth = new Date(Date.UTC(year, month, 1));
  let hi = nextMonth < dayWindowStart ? nextMonth : dayWindowStart;
  if (cutoff < hi) hi = cutoff;
  return { lo: monthStart, hi };
};
