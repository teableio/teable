import type { IRecord, ISearchHitIndex } from '@teable/core';
import { computeSearchHitIndex } from '@teable/core';
import type { IGetRecordsRo, IGroupHeaderRef, IGroupPointsVo } from '@teable/openapi';
import { getSearchMatches, getShareViewSearchMatches } from '@teable/openapi';
import { debounce, isEqual } from 'lodash';
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
} from 'react';
import type { IGridProps, IRectangle } from '../..';
import { ShareViewContext } from '../../../context/table/ShareViewContext';
import { useFields, usePersonalView, useSearch, useTableId, useView } from '../../../hooks';
import { useRecords } from '../../../hooks/use-records';
import { useTableListener } from '../../../hooks/use-table-listener';
import type { Record as IRecordInstance } from '../../../model';
import { applyCollapsedGroupChange, collectGroupRowCounts } from '../../../utils/collapsed-group';
import type { ILoadedRecordFields } from '../../../utils/column-projection';
import {
  frozenFieldIdsFromView,
  markRecordsFieldsLoaded,
  missingFieldsAcrossRecords,
  pruneLoadedFieldsToRecordIds,
  viewportFieldIds,
} from '../../../utils/column-projection';
import {
  computeNextWindowQuery,
  INITIAL_LOAD_PAGE_SIZE,
  LOAD_PAGE_SIZE,
} from '../../../utils/record-window';
import { MAX_POINTS_PER_ENTRY, useGridViewCacheStore } from '../store/useGridViewCacheStore';
import { generateLocalId } from '../utils';

export { INITIAL_LOAD_PAGE_SIZE, LOAD_PAGE_SIZE };
const defaultVisiblePages = { x: 0, y: 0, width: 0, height: 0 };

type IRes = {
  allGroupHeaderRefs: IGroupHeaderRef[] | null;
  groupPoints: IGroupPointsVo | null;
  searchHitIndex?: ISearchHitIndex;
  recordMap: IRecordIndexMap;
  loadedFieldsByRecordId: ReadonlyMap<string, ILoadedRecordFields>;
  snapshotFieldIds: ReadonlySet<string>;
  onReset: () => void;
  onForceUpdate: () => void;
  recordsQuery: IGetRecordsRo;
  onVisibleRegionChanged: NonNullable<IGridProps['onVisibleRegionChanged']>;
};

export type IRecordIndexMap = { [i: number | string]: IRecordInstance };
type IGridOuterQuery = Pick<
  IGetRecordsRo,
  'filter' | 'orderBy' | 'groupBy' | 'collapsedGroupIds' | 'ignoreViewQuery' | 'projection'
>;

export const useGridAsyncRecords = (
  initRecords?: IRecord[],
  initQuery?: IGetRecordsRo,
  outerQuery?: IGridOuterQuery,
  initGroupPoints?: IGroupPointsVo
): IRes => {
  const [query, setQuery] = useState<IGetRecordsRo>({
    skip: 0,
    take: INITIAL_LOAD_PAGE_SIZE,
    ...initQuery,
  });
  const recordsQuery = useMemo(() => ({ ...query, ...outerQuery }), [query, outerQuery]);
  const queryRef = useRef(query);
  queryRef.current = query;

  const view = useView();
  const tableId = useTableId();
  const { isPersonalView } = usePersonalView();
  const { searchQuery, hideNotMatchRow } = useSearch();
  const fields = useFields();
  const { records, extra, fillProjectedRecordFields, subscribeProjection, queryScopeKey } =
    useRecords(recordsQuery, initRecords, { sparseColumnFill: true });
  // ShareDB query extra: the group structure and header refs of the current
  // result page. The records hook treats it as opaque; this is its shape.
  const extraData = extra as
    | { groupPoints?: IGroupPointsVo | null; allGroupHeaderRefs?: IGroupHeaderRef[] }
    | null
    | undefined;
  // a personal view queries a different result set than its shared twin, so
  // it gets its own group-points cache slot
  const groupPointsCacheKey = `${generateLocalId(tableId, view?.id)}${isPersonalView ? '-personal' : ''}`;
  // embedded reuses of this hook (e.g. PreviewTable) carry their own
  // initQuery: their result sets answer a different question than the main
  // grid, so they must neither read nor write the per-view cache
  const cacheEnabled = initQuery == null;
  const [loadedRecordMap, setLoadedRecordMap] = useState<IRecordIndexMap>(() => {
    if (!records.length) return {};
    return records.reduce((acc, record, i) => {
      acc[i] = record;
      return acc;
    }, {} as IRecordIndexMap);
  });

  const { shareId } = useContext(ShareViewContext);
  const [searchRevision, setSearchRevision] = useState(0);
  const scheduleSearchRefresh = useMemo(
    () => debounce(() => setSearchRevision((revision) => revision + 1), 250, { maxWait: 1000 }),
    []
  );
  useEffect(() => () => scheduleSearchRefresh.cancel(), [scheduleSearchRefresh]);
  useTableListener(
    tableId,
    ['setRecord', 'addRecord', 'deleteRecord', 'addField', 'setField', 'deleteField'],
    scheduleSearchRefresh
  );
  useEffect(() => {
    window.addEventListener('online', scheduleSearchRefresh);
    return () => window.removeEventListener('online', scheduleSearchRefresh);
  }, [scheduleSearchRefresh]);

  const loadedRecordIds = Object.values(loadedRecordMap).map((record) => record.id);
  const loadedRecordIdsKey = JSON.stringify(loadedRecordIds);
  const searchFilter = shareId ? view?.filter : outerQuery?.filter;
  const searchProjection = shareId ? fields.map(({ id }) => id) : outerQuery?.projection;
  const searchRequestKey = JSON.stringify([
    tableId,
    shareId,
    view?.id,
    view?.filter,
    view?.columnMeta,
    hideNotMatchRow,
    outerQuery,
    searchQuery,
    loadedRecordIdsKey,
    searchFilter,
    searchProjection,
  ]);
  const searchKey = JSON.stringify([searchRequestKey, searchRevision]);
  const searchRetryRef = useRef({ key: searchRequestKey, attempt: 0 });
  const [serverSearchHits, setServerSearchHits] = useState<{
    key: string;
    hits: ISearchHitIndex;
  }>();
  useEffect(() => {
    if (hideNotMatchRow || !searchQuery?.[0] || !tableId || !view || !loadedRecordIds.length)
      return;
    let cancelled = false;
    const fetchHits = async () => {
      const hits: ISearchHitIndex = [];
      for (let start = 0; start < loadedRecordIds.length; start += 1000) {
        const selectedRecordIds = loadedRecordIds.slice(start, start + 1000);
        const scope = {
          search: searchQuery,
          filter: searchFilter,
          orderBy: outerQuery?.orderBy,
          groupBy: outerQuery?.groupBy,
          projection: searchProjection,
          selectedRecordIds,
          skip: 0,
          take: selectedRecordIds.length,
        };
        const response = shareId
          ? await getShareViewSearchMatches(shareId, scope)
          : await getSearchMatches(tableId, {
              ...scope,
              viewId: view.id,
              ignoreViewQuery: outerQuery?.ignoreViewQuery,
            });
        hits.push(...response.data.matches.map(({ recordId, fieldId }) => ({ recordId, fieldId })));
      }
      if (!cancelled) {
        searchRetryRef.current = { key: searchRequestKey, attempt: 0 };
        setServerSearchHits({ key: searchKey, hits });
      }
    };
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    void fetchHits().catch((error: unknown) => {
      if (cancelled) return;
      console.error('Failed to load grid search matches', error);
      const retry = searchRetryRef.current;
      const attempt = retry.key === searchRequestKey ? retry.attempt : 0;
      searchRetryRef.current = { key: searchRequestKey, attempt: attempt + 1 };
      retryTimer = setTimeout(
        () => setSearchRevision((revision) => revision + 1),
        Math.min(1000 * 2 ** attempt, 30_000)
      );
    });
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
    // The serialized key contains the complete bounded request identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey]);
  const searchHitIndex = hideNotMatchRow
    ? computeSearchHitIndex(Object.values(loadedRecordMap), fields, searchQuery)
    : serverSearchHits?.key === searchKey
      ? serverSearchHits.hits
      : undefined;

  const [groupPoints, setGroupPoints] = useState<IGroupPointsVo>(
    () => (extra == null ? initGroupPoints : extraData?.groupPoints) ?? null
  );

  // remember each expanded group's visible row count; a group keeps its last
  // known value while collapsed, so expanding it later can restore its row
  // block in place instead of dropping everything behind it. Row data and
  // group structure are never retained: a cached first frame is by definition
  // a previous result set.
  const prevGroupPointsCacheKeyRef = useRef(groupPointsCacheKey);
  useEffect(() => {
    const keyChanged = prevGroupPointsCacheKeyRef.current !== groupPointsCacheKey;
    prevGroupPointsCacheKeyRef.current = groupPointsCacheKey;
    if (!cacheEnabled) return;
    // on the render where the view switched, groupPoints may still hold the
    // previous view's structure — writing it here would poison the new
    // view's slot, so skip until state and key agree again
    if (keyChanged) return;
    const cache = useGridViewCacheStore.getState();
    if (groupPoints?.length && groupPoints.length <= MAX_POINTS_PER_ENTRY) {
      cache.mergeGroupRowCounts(groupPointsCacheKey, collectGroupRowCounts(groupPoints));
    } else if (groupPoints != null) {
      // empty or unbounded structure: no placeable layout to remember
      cache.clearGroupRowCounts(groupPointsCacheKey);
    }
  }, [groupPoints, groupPointsCacheKey, cacheEnabled]);
  const recordsScopeKey = useMemo(
    () =>
      JSON.stringify({
        initQuery,
        // collapse/expand toggles are excluded: they get a soft path in the
        // combined effect below (patch the layout in place) instead of the wipe
        outerQuery: { ...outerQuery, collapsedGroupIds: undefined },
      }),
    [initQuery, outerQuery]
  );
  const collapsedGroupIdsKey = useMemo(
    () => JSON.stringify(outerQuery?.collapsedGroupIds ?? null),
    [outerQuery]
  );
  // on a shared (non-personal) view the server resolves filter/sort (and
  // row-hiding search) through viewId, so they redefine the result set without
  // appearing in initQuery/outerQuery: the subscription stays alive and the
  // server pushes nothing when the new result set equals the old one. For those
  // changes the cache must keep the current page (still correct in that case)
  // and only drop the entries retained from the previous result set. Group and
  // personal-view changes also flow through outerQuery — the scope wipe handles
  // them and takes precedence in the combined effect below; collapse toggles
  // are carved out of that key and patched in place instead.
  const viewQueryScopeKey = useMemo(
    () =>
      JSON.stringify({
        viewId: view?.id,
        filter: view?.filter,
        sort: view?.sort,
        group: view?.group,
        // opening the search box enables hide-not-match UI state before any
        // probe exists; that must not count as a row-set change (T7211)
        search: hideNotMatchRow && searchQuery ? searchQuery : null,
      }),
    [view, hideNotMatchRow, searchQuery]
  );
  const [visiblePages, setVisiblePages] = useState<IRectangle>(defaultVisiblePages);
  const [viewportReady, setViewportReady] = useState(false);
  const visiblePagesRef = useRef(visiblePages);
  visiblePagesRef.current = visiblePages;
  const previousRecordsScopeKeyRef = useRef(recordsScopeKey);
  const previousViewQueryScopeKeyRef = useRef(viewQueryScopeKey);
  const previousCollapsedGroupIdsKeyRef = useRef(collapsedGroupIdsKey);
  // identity of what the grid's own `query` state derives from: the live record
  // subscription plus the initQuery that state rebuilds from. An unchanged pair
  // means the running ShareDB query keeps delivering and no fresh `ready`
  // snapshot is coming, even if the query props changed their shape — but a
  // swapped initQuery (an embedded grid, whose state initializes from it only on
  // mount) must still take the wipe/re-seed path to pick the new query up.
  const recordsSubscriptionKey = useMemo(
    () => `${queryScopeKey}|${JSON.stringify(initQuery ?? null)}`,
    [queryScopeKey, initQuery]
  );
  const previousRecordsSubscriptionKeyRef = useRef(recordsSubscriptionKey);
  const hideNotMatchSearchKey = hideNotMatchRow && searchQuery ? JSON.stringify(searchQuery) : '';
  const previousHideNotMatchSearchKeyRef = useRef(hideNotMatchSearchKey);
  const lastMergedSkipRef = useRef(0);
  const loadedRecordMapRef = useRef(loadedRecordMap);
  loadedRecordMapRef.current = loadedRecordMap;
  const groupPointsRef = useRef(groupPoints);
  groupPointsRef.current = groupPoints;

  // true between a scope switch and its first fresh delivery: that delivery
  // must REPLACE the placeholder map instead of merging into it, or a shorter
  // live result would leave the stale tail on screen indefinitely
  // starts true: mount is equivalent to a scope switch — the first delivery
  // is authoritative
  const pendingFreshRef = useRef(true);
  // true once the live subscription delivered the current scope. Until then
  // the bootstrap seed (rows + group structure) is the authority; after it,
  // late seed props must not override the server-pushed structure.
  const liveDeliveryRef = useRef(false);

  const subscribeProjectionRef = useRef(subscribeProjection);
  subscribeProjectionRef.current = subscribeProjection;
  const [loadedFieldsByRecordId, setLoadedFieldsByRecordId] = useState<
    Map<string, ILoadedRecordFields>
  >(() => new Map());
  const loadedFieldsByRecordIdRef = useRef(loadedFieldsByRecordId);
  loadedFieldsByRecordIdRef.current = loadedFieldsByRecordId;

  const onForceUpdate = useCallback(() => {
    const startIndex = queryRef.current.skip ?? 0;
    const take = queryRef.current.take ?? LOAD_PAGE_SIZE;
    lastMergedSkipRef.current = startIndex;
    const isFirstFreshDelivery = pendingFreshRef.current && (extra != null || records.length > 0);
    if (isFirstFreshDelivery) {
      pendingFreshRef.current = false;
    }
    if (extra != null) {
      liveDeliveryRef.current = true;
    }
    setLoadedRecordMap((preLoadedRecords) => {
      const cacheLen = take * 2;
      const [cacheStartIndex, cacheEndIndex] = [
        Math.max(startIndex - cacheLen / 2, 0),
        startIndex + records.length + cacheLen / 2,
      ];
      const newRecordsState: IRecordIndexMap = {};
      for (let i = cacheStartIndex; i < cacheEndIndex; i++) {
        if (startIndex <= i && i < startIndex + records.length) {
          const record = records[i - startIndex];
          if (record !== undefined) {
            newRecordsState[i] = record;
          }
          continue;
        }
        // the first delivery after a scope switch is authoritative for the new
        // result set — retaining seeded/stale entries beyond it would keep
        // rows that no longer belong to the view
        if (isFirstFreshDelivery) continue;
        const cachedRecord = preLoadedRecords[i];
        if (cachedRecord !== undefined) {
          newRecordsState[i] = cachedRecord;
        }
      }
      // keep the previous reference when nothing changed: consumers key effects
      // on the map's identity, and a re-run updater must not restart them
      const prevKeys = Object.keys(preLoadedRecords);
      const nextKeys = Object.keys(newRecordsState);
      const unchanged =
        prevKeys.length === nextKeys.length &&
        nextKeys.every((key) => preLoadedRecords[key] === newRecordsState[key]);
      return unchanged ? preLoadedRecords : newRecordsState;
    });

    if (extra != null) {
      const freshGroupPoints = extraData?.groupPoints ?? null;
      // deliveries re-send a structurally identical list on every page (and
      // after an exact local collapse patch): keep the previous reference so
      // the grid does not rebuild its O(total rows) linear layout for nothing
      setGroupPoints((prev) => (isEqual(prev, freshGroupPoints) ? prev : freshGroupPoints));
    }
  }, [records, extra, extraData]);

  // layout effect to keep its declaration-order contract with the scope
  // effect below (merge first, wipe/seed second) now that both must flush
  // before paint — a passive merge would stomp the pre-paint seed
  useLayoutEffect(() => onForceUpdate(), [onForceUpdate]);

  const previousScopeCacheKeyRef = useRef(groupPointsCacheKey);
  // layout effect on purpose: the wipe must run BEFORE the browser paints the
  // post-switch frame, otherwise one frame of "new view's columns × previous
  // view's rows" flashes on screen
  useLayoutEffect(() => {
    const recordsScopeChanged = previousRecordsScopeKeyRef.current !== recordsScopeKey;
    const viewQueryScopeChanged = previousViewQueryScopeKeyRef.current !== viewQueryScopeKey;
    const collapsedGroupIdsChanged =
      previousCollapsedGroupIdsKeyRef.current !== collapsedGroupIdsKey;
    const searchChanged = previousHideNotMatchSearchKeyRef.current !== hideNotMatchSearchKey;
    const previousCacheKey = previousScopeCacheKeyRef.current;
    const cacheKeyChanged = previousCacheKey !== groupPointsCacheKey;
    const subscriptionChanged =
      previousRecordsSubscriptionKeyRef.current !== recordsSubscriptionKey;
    previousRecordsScopeKeyRef.current = recordsScopeKey;
    previousViewQueryScopeKeyRef.current = viewQueryScopeKey;
    previousCollapsedGroupIdsKeyRef.current = collapsedGroupIdsKey;
    previousScopeCacheKeyRef.current = groupPointsCacheKey;
    previousHideNotMatchSearchKeyRef.current = hideNotMatchSearchKey;
    previousRecordsSubscriptionKeyRef.current = recordsSubscriptionKey;

    const keySwitched = cacheEnabled && cacheKeyChanged;
    const resetToBootstrapState = (useSeedStructure: boolean) => {
      // never paint the previous result set under the target view: the fresh
      // seed (rows + structure) or the live subscription owns the first frame.
      // A same-view scope change has no seed for the new result set, so its
      // structure must drop to the loading placeholder as well.
      setLoadedRecordMap({});
      setGroupPoints(useSeedStructure ? (initGroupPoints ?? null) : null);
    };

    // row counts collected under the previous result set must not place rows
    // under a redefined one — cleared on every same-view scope change
    const clearCachedGroupRowCounts = () => {
      if (!cacheEnabled) return;
      useGridViewCacheStore.getState().clearGroupRowCounts(groupPointsCacheKey);
    };

    const patchCollapsedGroupState = () => {
      // a simultaneous view-query change (e.g. search toggling row hiding
      // while it expands all groups) redefines the result set — drop the
      // cached counts so neither this patch nor a later expand uses them
      if (viewQueryScopeChanged) {
        clearCachedGroupRowCounts();
      }
      const knownRowCounts = cacheEnabled
        ? useGridViewCacheStore.getState().cacheMap[groupPointsCacheKey]?.groupRowCounts
        : undefined;
      const patched = applyCollapsedGroupChange(
        groupPointsRef.current,
        loadedRecordMapRef.current,
        new Set(outerQuery?.collapsedGroupIds),
        knownRowCounts
      );
      setGroupPoints(patched.groupPoints);
      setLoadedRecordMap(patched.recordMap);
    };

    // a scope change re-creates the subscription, which always delivers a fresh
    // ready event. A view switch has no valid first-frame data until the
    // target view's seed or subscription arrives — seeding the previous
    // view's rows or a session snapshot would present another result set
    // under the target view's configuration, which is exactly the stale-row
    // bug this path must prevent. The wipe is only safe when the subscription
    // really re-created: enabling the personal view re-shapes the query props
    // while the live query is reused (it inlines the same conditions), so no
    // ready event is coming and dropping the rows would leave placeholders
    // that never resolve — the personal cache slot is empty — until a remount
    // (T7486). An unchanged subscription falls through to the in-place paths
    // below, which keep the rows on screen.
    if (recordsScopeChanged && subscriptionChanged) {
      pendingFreshRef.current = true;
      liveDeliveryRef.current = false;
      // a view switch may already hold the target view's seed structure; a
      // same-view scope change must not reuse the seed of the old result set
      resetToBootstrapState(keySwitched || !cacheEnabled);
      if (!keySwitched) {
        clearCachedGroupRowCounts();
      }
      setVisiblePages(defaultVisiblePages);
      setViewportReady(false);
      return;
    }

    // collapse/expand toggle on the same view: the subscription re-creates
    // (the ids ride in the query), but the new result is the same rows minus
    // the collapsed ones — patch the group layout and loaded rows in place
    // instead of dropping the whole grid to loading placeholders, keeping the
    // scroll position and the other groups on screen. The first fresh
    // delivery then replaces everything (pendingFresh) with server truth
    if (collapsedGroupIdsChanged && !cacheKeyChanged) {
      pendingFreshRef.current = true;
      patchCollapsedGroupState();
      return;
    }

    if (!viewQueryScopeChanged) return;

    // a view switch can land here too (same records scope, new viewId): the
    // rows on screen belong to the previous view, and its order/filter may
    // differ — never keep another view's data; fall back to placeholders and
    // let the target view's seed or subscription fill the first frame
    if (cacheKeyChanged) {
      pendingFreshRef.current = true;
      liveDeliveryRef.current = false;
      resetToBootstrapState(true);
      return;
    }

    if (searchChanged) {
      // Hide-not-match search redefines the row set. Keeping the previous
      // first page makes unmatched default rows look like search hits (T7058).
      pendingFreshRef.current = true;
      liveDeliveryRef.current = false;
      setLoadedRecordMap({});
      setGroupPoints(null);
      clearCachedGroupRowCounts();
      setVisiblePages(defaultVisiblePages);
      setViewportReady(false);
      return;
    }

    // same-view query change (filter/sort edits): the subscription stays alive
    // and the server pushes nothing when the new result set equals the old one
    // — keep the current page (still correct in that case, diff events
    // overwrite it otherwise) and only drop the retained entries
    clearCachedGroupRowCounts();
    const startIndex = lastMergedSkipRef.current;
    setLoadedRecordMap(() =>
      records.reduce((acc, record, i) => {
        acc[startIndex + i] = record;
        return acc;
      }, {} as IRecordIndexMap)
    );
  }, [
    recordsScopeKey,
    recordsSubscriptionKey,
    viewQueryScopeKey,
    collapsedGroupIdsKey,
    outerQuery,
    records,
    extra,
    groupPointsCacheKey,
    cacheEnabled,
    initGroupPoints,
    hideNotMatchSearchKey,
  ]);

  // A bootstrap seed is one snapshot: its rows and its group structure must
  // change together. The rows arrive through `records`, but the structure only
  // through `initGroupPoints` — without this, a seed that lands after the
  // switch would place its rows without the groups they belong to. Once the
  // live subscription delivers, extra owns the structure and this stops
  // applying.
  useLayoutEffect(() => {
    if (!cacheEnabled || initGroupPoints === undefined || liveDeliveryRef.current) return;
    setGroupPoints((prev) => (isEqual(prev, initGroupPoints) ? prev : initGroupPoints));
  }, [initGroupPoints, cacheEnabled, groupPointsCacheKey]);

  useEffect(() => {
    const { y, height } = visiblePages;
    setQuery((cv) => {
      if (cv.skip === undefined) {
        return cv;
      }

      const next = computeNextWindowQuery(cv, y, height, initQuery?.take ?? LOAD_PAGE_SIZE);
      if (next) {
        if (next.skip === cv.skip && next.take === cv.take) {
          return cv;
        }
        return {
          ...initQuery,
          ...next,
        };
      }
      return cv;
    });
  }, [visiblePages, initQuery]);

  const updateVisiblePages = useMemo(() => {
    return debounce(setVisiblePages, 30, { maxWait: 500 });
  }, []);

  const onVisibleRegionChanged: NonNullable<IGridProps['onVisibleRegionChanged']> = useCallback(
    (r) => {
      const current = visiblePagesRef.current;
      setViewportReady(true);
      if (
        r.y === current.y &&
        r.height === current.height &&
        r.x === current.x &&
        r.width === current.width
      ) {
        return;
      }
      updateVisiblePages(r);
    },
    [updateVisiblePages]
  );

  const subscribeProjectionKey = (subscribeProjection ?? []).join(',');
  useEffect(() => {
    loadedFieldsByRecordIdRef.current = new Map();
    setLoadedFieldsByRecordId((prev) => (prev.size === 0 ? prev : new Map()));
  }, [subscribeProjectionKey, recordsScopeKey, query.skip, query.take]);

  useEffect(() => {
    const next = pruneLoadedFieldsToRecordIds(
      loadedFieldsByRecordIdRef.current,
      records.map((record) => record.id)
    );
    if (!next) {
      return;
    }
    loadedFieldsByRecordIdRef.current = next;
    setLoadedFieldsByRecordId(next);
  }, [records]);

  useEffect(() => {
    if (!viewportReady || !fillProjectedRecordFields) {
      return;
    }
    const orderedVisibleFieldIds = fields.map((field) => field.id);
    const viewOptions = view?.options as
      | { frozenFieldId?: string; frozenColumnCount?: number }
      | undefined;
    const frozenIds = frozenFieldIdsFromView({
      orderedVisibleFieldIds,
      frozenFieldId: viewOptions?.frozenFieldId,
      frozenColumnCount: viewOptions?.frozenColumnCount,
    });
    const needed = [
      ...viewportFieldIds({
        orderedVisibleFieldIds,
        startColumnIndex: visiblePages.x,
        columnSpan: visiblePages.width,
        freezeCount: frozenIds.length,
      }),
    ];
    const searchFieldKey =
      Array.isArray(searchQuery) && typeof searchQuery[1] === 'string' ? searchQuery[1] : undefined;
    if (searchFieldKey) {
      for (const fieldId of searchFieldKey.split(',')) {
        if (fieldId.startsWith('fld')) {
          needed.push(fieldId);
        }
      }
    }
    const snapshotFieldIds = new Set(subscribeProjectionRef.current ?? []);
    const missing = missingFieldsAcrossRecords(
      records,
      needed,
      loadedFieldsByRecordIdRef.current,
      snapshotFieldIds
    );
    if (!missing.length) {
      return;
    }
    let cancelled = false;
    void fillProjectedRecordFields(missing).then((ok) => {
      if (cancelled || !ok) {
        return;
      }
      const next = markRecordsFieldsLoaded(
        loadedFieldsByRecordIdRef.current,
        records,
        missing,
        snapshotFieldIds
      );
      loadedFieldsByRecordIdRef.current = next;
      setLoadedFieldsByRecordId(next);
    });
    return () => {
      cancelled = true;
    };
  }, [
    visiblePages.x,
    visiblePages.width,
    visiblePages.height,
    viewportReady,
    fields,
    records,
    fillProjectedRecordFields,
    view,
    searchQuery,
  ]);

  const snapshotFieldIds = useMemo(() => new Set(subscribeProjection ?? []), [subscribeProjection]);

  const onReset = useCallback(() => {
    // callers reset on table switches; the target table's seed or subscription
    // owns the next frame, so never restore a previous table's snapshot
    setLoadedRecordMap({});
    setVisiblePages(defaultVisiblePages);
    setViewportReady(false);
  }, []);

  return {
    groupPoints,
    allGroupHeaderRefs: extraData?.allGroupHeaderRefs ?? null,
    recordMap: loadedRecordMap,
    loadedFieldsByRecordId,
    snapshotFieldIds,
    onVisibleRegionChanged,
    recordsQuery,
    onForceUpdate,
    onReset,
    searchHitIndex,
  };
};
