import type { IRecord } from '@teable/core';
import type { IGroupHeaderRef, IGroupPointsVo } from '@teable/openapi';
import { create } from 'zustand';
import type { IGroupRowCountMap } from '../../../utils/collapsed-group';

const MAX_CACHE_ENTRIES = 10;
export const MAX_SNAPSHOT_ROWS = 100;
// long-text / attachment heavy rows can dwarf the row-count cap, so the
// collector also enforces a byte budget per snapshot (see the hook)
export const MAX_SNAPSHOT_BYTES = 512 * 1024;
// grouping by a high-cardinality field can produce one point per record;
// caching such a structure buys little (the flat->grouped reflow it prevents
// is proportionally tiny) and costs the most memory, so treat it as uncacheable
export const MAX_POINTS_PER_ENTRY = 5000;

interface IGridViewCacheEntry {
  groupPoints?: IGroupPointsVo;
  groupHeaderRefs?: IGroupHeaderRef[];
  rows?: IRecord[];
  groupRowCounts?: IGroupRowCountMap;
}

interface IGridViewCacheState {
  // localId(tableId-viewId[-personal]) -> the view's last known first-screen
  // state, seeding the first frame when the user switches back. One entry per
  // view so group structure and rows are cached and evicted ATOMICALLY — a
  // "rows without group structure" half-state would reintroduce the
  // flat-then-grouped reflow this cache exists to prevent.
  //
  // Session memory only, PLAIN DATA only (rows are deep-cloned IRecord JSON):
  // instances hold ShareDB doc references and subscriptions, which would pin
  // whole object graphs in memory.
  cacheMap: Record<string, IGridViewCacheEntry>;
  // empty or oversized groupPoints CLEAR the facet instead of being stored:
  // a stale structure would otherwise reseed an obsolete layout on every
  // revisit, which is worse than falling back to plain placeholders
  setGroupPoints: (
    key: string,
    groupPoints: IGroupPointsVo,
    groupHeaderRefs?: IGroupHeaderRef[]
  ) => void;
  // empty rows CLEAR the facet: the caller only passes [] when the view has
  // settled empty, meaning the previous snapshot is known to be obsolete
  setRows: (key: string, rows: IRecord[]) => void;
  // fresh counts MERGE over the previous map: currently collapsed groups are
  // absent from fresh group points and keep their last known value — the
  // value the expand patch needs to restore the group's row block in place
  mergeGroupRowCounts: (key: string, counts: IGroupRowCountMap) => void;
  // filter/sort/search changes redefine what "visible rows" means; counts
  // collected under the previous result set must not place rows under the new
  // one, so the caller clears the facet on same-view scope changes
  clearGroupRowCounts: (key: string) => void;
}

type ICacheMap = Record<string, IGridViewCacheEntry>;

const upsert = (cacheMap: ICacheMap, key: string, patch: IGridViewCacheEntry): ICacheMap => {
  const next = { ...cacheMap };
  const entry = { ...next[key], ...patch };
  // re-insert to refresh recency for the insertion-order LRU trim below
  delete next[key];
  next[key] = entry;
  const keys = Object.keys(next);
  if (keys.length > MAX_CACHE_ENTRIES) {
    for (const staleKey of keys.slice(0, keys.length - MAX_CACHE_ENTRIES)) {
      delete next[staleKey];
    }
  }
  return next;
};

const dropFacets = (
  cacheMap: ICacheMap,
  key: string,
  facets: (keyof IGridViewCacheEntry)[]
): ICacheMap | undefined => {
  const entry = cacheMap[key];
  if (!entry || facets.every((facet) => entry[facet] === undefined)) return undefined;
  const next = { ...cacheMap };
  const rest = { ...entry };
  facets.forEach((facet) => delete rest[facet]);
  if (Object.keys(rest).length) {
    next[key] = rest;
  } else {
    delete next[key];
  }
  return next;
};

export const useGridViewCacheStore = create<IGridViewCacheState>()((set) => ({
  cacheMap: {},
  setGroupPoints: (key, groupPoints, groupHeaderRefs) =>
    set((state) => {
      if (!groupPoints?.length || groupPoints.length > MAX_POINTS_PER_ENTRY) {
        const next = dropFacets(state.cacheMap, key, ['groupPoints', 'groupHeaderRefs']);
        return next ? { cacheMap: next } : state;
      }
      return {
        cacheMap: upsert(state.cacheMap, key, {
          groupPoints,
          // keep previously cached refs when the caller has none at hand
          ...(groupHeaderRefs ? { groupHeaderRefs } : {}),
        }),
      };
    }),
  setRows: (key, rows) =>
    set((state) => {
      if (!rows.length) {
        const next = dropFacets(state.cacheMap, key, ['rows']);
        return next ? { cacheMap: next } : state;
      }
      return { cacheMap: upsert(state.cacheMap, key, { rows: rows.slice(0, MAX_SNAPSHOT_ROWS) }) };
    }),
  mergeGroupRowCounts: (key, counts) =>
    set((state) => {
      if (!Object.keys(counts).length) return state;
      const merged = { ...state.cacheMap[key]?.groupRowCounts, ...counts };
      // degenerate cardinality: keep only the fresh counts instead of
      // accumulating an unbounded map of long-gone group ids
      const groupRowCounts = Object.keys(merged).length > MAX_POINTS_PER_ENTRY ? counts : merged;
      return { cacheMap: upsert(state.cacheMap, key, { groupRowCounts }) };
    }),
  clearGroupRowCounts: (key) =>
    set((state) => {
      const next = dropFacets(state.cacheMap, key, ['groupRowCounts']);
      return next ? { cacheMap: next } : state;
    }),
}));
