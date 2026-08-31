// Read-side part-scan predicates shared by every cold subsystem. Each one is a
// pure function over a part's KEY SHAPE plus a stats lookup, so a subsystem
// passes its own IParsedPartKey (structurally a superset) and its own entry
// accessor without this module knowing the row type.

/** The key fields a scan needs; every subsystem's IParsedPartKey satisfies it. */
export interface IScannedPartKey {
  key: string;
  yyyymm: string;
  kind: 'day' | 'month';
  /** two digit day, only for kind=day */
  dd?: string;
  /**
   * Writer-run token: distinct tokens in one bucket = distinct generations.
   * Optional because not every subsystem's key layout carries one — where it
   * is absent the generation checks below self-disable rather than needing a
   * caller-supplied flag.
   */
  runToken?: string;
}

/** [min, max] createdTime bounds of one part, as recorded in stats. */
export interface IPartTimeBounds {
  minCreatedTime: string;
  maxCreatedTime: string;
}

export type PartEntryLookup = (key: string) => IPartTimeBounds | undefined;

/**
 * A key from a listing can vanish mid-read when a flusher/compactor heal pass
 * deletes it, so a missing part is a retry signal rather than a failure.
 */
/** [lo, hi) ISO range of a month dir */
export const monthRange = (yyyymm: string): { lo: string; hi: string } => {
  const year = Number(yyyymm.slice(0, 4));
  const month = Number(yyyymm.slice(4, 6));
  return {
    lo: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
    hi: new Date(Date.UTC(year, month, 1)).toISOString(),
  };
};

/** [lo, hi) ISO range of a part's bucket */
export const bucketRangeOf = (part: IScannedPartKey): { lo: string; hi: string } => {
  if (part.kind !== 'day') return monthRange(part.yyyymm);
  const year = Number(part.yyyymm.slice(0, 4));
  const month = Number(part.yyyymm.slice(4, 6));
  const day = Number(part.dd);
  return {
    lo: new Date(Date.UTC(year, month - 1, day)).toISOString(),
    hi: new Date(Date.UTC(year, month - 1, day + 1)).toISOString(),
  };
};

/**
 * [min, max] createdTime range of a part group per its stats entries;
 * undefined when any part lacks an entry (the range cannot be proven).
 */
export const statsRangeOf = (
  parts: IScannedPartKey[],
  entryOf: PartEntryLookup
): { min: string; max: string } | undefined => {
  let min: string | undefined;
  let max: string | undefined;
  for (const part of parts) {
    const entry = entryOf(part.key);
    if (!entry) return undefined;
    if (min === undefined || entry.minCreatedTime < min) min = entry.minCreatedTime;
    if (max === undefined || entry.maxCreatedTime > max) max = entry.maxCreatedTime;
  }
  return min === undefined || max === undefined ? undefined : { min, max };
};

const groupBy = <TKey, TItem>(items: TItem[], keyOf: (item: TItem) => TKey): Map<TKey, TItem[]> => {
  const groups = new Map<TKey, TItem[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
};

/**
 * Whether any two of these ranges share an instant. A shared bound counts as
 * sharing: the row sitting on it could belong to either side. Sorting by start
 * and carrying the furthest end seen keeps this pairwise — comparing only
 * neighbours would miss a short range nested inside a long one.
 */
const rangesMayOverlap = (ranges: { min: string; max: string }[]): boolean => {
  const sorted = [...ranges].sort((a, b) => (a.min < b.min ? -1 : a.min > b.min ? 1 : 0));
  let reach: string | undefined;
  for (const range of sorted) {
    if (reach !== undefined && range.min <= reach) return true;
    if (reach === undefined || range.max > reach) reach = range.max;
  }
  return false;
};

/**
 * Two generations in one bucket duplicate rows unless their stats ranges prove
 * otherwise — the same exoneration the day/month case gets, for the same
 * reason: both copies of a row share its createdTime, so generations confined
 * to disjoint time ranges cannot hold the same row.
 *
 * The comparison is between GENERATIONS, never between individual parts: one
 * writer cuts its parts on size, so consecutive parts of a single generation
 * routinely meet at a shared timestamp, which says nothing about duplication.
 *
 * The daily flush archives a window that opens and closes mid-day, so the day
 * it crosses is written by two consecutive runs — the earlier hours by one,
 * the later hours by the next. That bucket carries two generations for as long
 * as the month stays open, and only the ranges can tell it apart from a real
 * duplicate.
 *
 * A layout that carries no token at all groups into one generation and is
 * exonerated by the size check below, which is how the generation test keeps
 * self-disabling where keys cannot express a writer run.
 */
const generationsMayOverlap = (
  bucketParts: IScannedPartKey[],
  entryOf: PartEntryLookup
): boolean => {
  const byGeneration = groupBy(bucketParts, (part) => part.runToken);
  if (byGeneration.size < 2) return false;
  const ranges: { min: string; max: string }[] = [];
  for (const generation of byGeneration.values()) {
    const range = statsRangeOf(generation, entryOf);
    if (!range) return true;
    ranges.push(range);
  }
  return rangesMayOverlap(ranges);
};

/**
 * Duplicated rows are possible inside a month whenever any logical bucket
 * carries parts from more than one writer generation (a heal pass died
 * mid-delete, or the daily window split the day between two runs), or when day
 * and month parts coexist — the day→month compaction folds the day rows into a
 * fresh month generation BEFORE the old day parts are deleted. Either case is
 * exonerated when the stats ranges of the groups involved are provably
 * disjoint (a legitimate split at a window bound): both copies of a row share
 * its createdTime, so disjoint time ranges cannot hold the same row. Different
 * day buckets partition rows by day and never overlap each other.
 */
export const partsMayDuplicateRows = (
  parts: IScannedPartKey[],
  entryOf: PartEntryLookup
): boolean => {
  const byBucket = groupBy(parts, (part) => (part.kind === 'month' ? 'm' : `d${part.dd}`));
  for (const bucketParts of byBucket.values()) {
    if (generationsMayOverlap(bucketParts, entryOf)) return true;
  }
  const dayParts = parts.filter((part) => part.kind === 'day');
  const monthParts = parts.filter((part) => part.kind === 'month');
  if (dayParts.length === 0 || monthParts.length === 0) return false;
  const dayGroupRange = statsRangeOf(dayParts, entryOf);
  const monthGroupRange = statsRangeOf(monthParts, entryOf);
  if (!dayGroupRange || !monthGroupRange) return true;
  return rangesMayOverlap([dayGroupRange, monthGroupRange]);
};

/**
 * Claims `id` in the dedup set: true = already counted by an earlier
 * generation's part, skip it.
 */
export const alreadyCounted = (dedupIds: Set<string> | undefined, id: string): boolean => {
  if (!dedupIds) return false;
  if (dedupIds.has(id)) return true;
  dedupIds.add(id);
  return false;
};
