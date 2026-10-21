import { create } from 'zustand';
import type { IGroupRowCountMap } from '../../../utils/collapsed-group';

const MAX_CACHE_ENTRIES = 10;
// grouping by a high-cardinality field can produce one point per record; a
// count map that size buys nothing for the in-place expand patch and costs the
// most memory, so treat such a structure as uncacheable
export const MAX_POINTS_PER_ENTRY = 5000;

interface IGridViewCacheEntry {
  groupRowCounts?: IGroupRowCountMap;
}

interface IGridViewCacheState {
  // localId(tableId-viewId[-personal]) -> the row count of each expanded group
  // at the last live delivery. A group keeps its last known count while
  // collapsed, so expanding it can restore its row block in place instead of
  // dropping everything behind it.
  //
  // This is layout bookkeeping only. Row data and group structure are never
  // seeded from it: a cached first frame is by definition a previous result
  // set, and presenting it under the current view's configuration is the
  // stale-row bug this store must not reintroduce.
  cacheMap: Record<string, IGridViewCacheEntry>;
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
