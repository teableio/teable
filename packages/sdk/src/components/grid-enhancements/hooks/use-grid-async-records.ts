import type { IRecord, ISearchHitIndex } from '@teable/core';
import { computeSearchHitIndex } from '@teable/core';
import type { IGetRecordsRo, IGroupHeaderRef, IGroupPointsVo } from '@teable/openapi';
import { debounce, keyBy } from 'lodash';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import type { IGridProps, IRectangle } from '../..';
import { useFields, usePersonalView, useSearch, useTableId, useView } from '../../../hooks';
import { useRecords } from '../../../hooks/use-records';
import type { IFieldInstance, Record as IRecordInstance } from '../../../model';
import { createRecordInstance, recordInstanceFieldMap } from '../../../model';
import {
  computeNextWindowQuery,
  INITIAL_LOAD_PAGE_SIZE,
  LOAD_PAGE_SIZE,
} from '../../../utils/record-window';
import {
  MAX_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_ROWS,
  useGridViewCacheStore,
} from '../store/useGridViewCacheStore';
import { generateLocalId } from '../utils';

export { INITIAL_LOAD_PAGE_SIZE, LOAD_PAGE_SIZE };
const defaultVisiblePages = { x: 0, y: 0, width: 0, height: 0 };

// keep snapshots pure data: pick the IRecord shape off the instance and deep
// clone it, so the cache never retains instances, docs or live doc.data.
// permissions/undeletable must ride along: without them a seeded record
// would render as unrestricted until the live subscription takes over
const RECORD_SNAPSHOT_KEYS = [
  'id',
  'name',
  'fields',
  'autoNumber',
  'createdTime',
  'lastModifiedTime',
  'createdBy',
  'lastModifiedBy',
  'permissions',
  'undeletable',
] as const;

const toPlainRecord = (instance: IRecordInstance): { record: IRecord; size: number } => {
  const raw = instance as unknown as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of RECORD_SNAPSHOT_KEYS) {
    if (raw[key] !== undefined) {
      picked[key] = raw[key];
    }
  }
  const json = JSON.stringify(picked);
  return { record: JSON.parse(json) as IRecord, size: json.length };
};

// contiguous first-screen rows only — the snapshot exists to stabilize the
// first frame after a switch back, which always starts at the top. Bounded by
// row count AND serialized size: long-text/attachment heavy rows must not
// turn the session cache into a memory sink
const collectFirstScreenRows = (map: IRecordIndexMap): IRecord[] => {
  const rows: IRecord[] = [];
  let budget = MAX_SNAPSHOT_BYTES;
  for (let i = 0; i < MAX_SNAPSHOT_ROWS; i++) {
    const instance = map[i];
    if (!instance) break;
    const { record, size } = toPlainRecord(instance);
    budget -= size;
    // a partial snapshot is fine — fewer seeded rows, same stability
    if (budget < 0) break;
    rows.push(record);
  }
  return rows;
};

const buildSeededRecordMap = (
  snapshot: IRecord[] | undefined,
  fields: IFieldInstance[],
  tableId?: string
): IRecordIndexMap | undefined => {
  if (!snapshot?.length) return undefined;
  const fieldMap = keyBy(fields, 'id');
  return snapshot.reduce((acc, data, i) => {
    // doc-less instance, same machinery as SSR seeds: renders immediately and
    // resolves cell edits over REST until the live subscription takes over
    const instance = createRecordInstance(data);
    instance.tableId = tableId as string;
    recordInstanceFieldMap(instance, fieldMap);
    acc[i] = instance;
    return acc;
  }, {} as IRecordIndexMap);
};

type IRes = {
  allGroupHeaderRefs: IGroupHeaderRef[];
  groupPoints: IGroupPointsVo | null;
  searchHitIndex?: ISearchHitIndex;
  recordMap: IRecordIndexMap;
  onReset: () => void;
  onForceUpdate: () => void;
  recordsQuery: IGetRecordsRo;
  onVisibleRegionChanged: NonNullable<IGridProps['onVisibleRegionChanged']>;
};

export type IRecordIndexMap = { [i: number | string]: IRecordInstance };

export const useGridAsyncRecords = (
  initRecords?: IRecord[],
  initQuery?: IGetRecordsRo,
  outerQuery?: Pick<IGetRecordsRo, 'filter' | 'orderBy' | 'groupBy' | 'collapsedGroupIds'>,
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
  const { records, extra } = useRecords(recordsQuery, initRecords);
  // a personal view queries a different result set than its shared twin, so
  // it gets its own group-points cache slot
  const groupPointsCacheKey = `${generateLocalId(tableId, view?.id)}${isPersonalView ? '-personal' : ''}`;
  // embedded reuses of this hook (e.g. PreviewTable) carry their own
  // initQuery: their result sets answer a different question than the main
  // grid, so they must neither read nor write the per-view cache
  const cacheEnabled = initQuery == null;
  const [loadedRecordMap, setLoadedRecordMap] = useState<IRecordIndexMap>(() => {
    if (records.length) {
      return records.reduce((acc, record, i) => {
        acc[i] = record;
        return acc;
      }, {} as IRecordIndexMap);
    }
    // remounts (e.g. switching back to this table) seed from the session
    // snapshot so the first frame shows the view's last known rows
    if (!cacheEnabled) return {};
    return (
      buildSeededRecordMap(
        useGridViewCacheStore.getState().cacheMap[groupPointsCacheKey]?.rows,
        fields,
        tableId
      ) ?? {}
    );
  });

  const searchHitIndex = useMemo<ISearchHitIndex | undefined>(
    () => computeSearchHitIndex(Object.values(loadedRecordMap), fields, searchQuery),
    [loadedRecordMap, fields, searchQuery]
  );

  const [groupPoints, setGroupPoints] = useState<IGroupPointsVo>(
    () =>
      (extra == null
        ? initGroupPoints
        : (extra as { groupPoints: IGroupPointsVo } | undefined)?.groupPoints) ??
      // remounts (e.g. a table switch back) seed from the session cache so the
      // group structure is present on the first frame
      (cacheEnabled
        ? useGridViewCacheStore.getState().cacheMap[groupPointsCacheKey]?.groupPoints
        : undefined) ??
      null
  );

  const extraRef = useRef(extra);
  extraRef.current = extra;

  // remember the latest group structure per view: it seeds the first frame
  // when the user switches back, instead of a flat list that reflows once the
  // subscription delivers. Group header refs ride along so collapse/expand
  // actions on cached headers keep working before the subscription is ready
  const prevGroupPointsCacheKeyRef = useRef(groupPointsCacheKey);
  useEffect(() => {
    const keyChanged = prevGroupPointsCacheKeyRef.current !== groupPointsCacheKey;
    prevGroupPointsCacheKeyRef.current = groupPointsCacheKey;
    if (!cacheEnabled) return;
    // on the render where the view switched, groupPoints may still hold the
    // previous view's structure — writing it here would poison the new
    // view's slot, so skip until state and key agree again
    if (keyChanged) return;
    if (view?.id && groupPoints != null) {
      useGridViewCacheStore
        .getState()
        .setGroupPoints(
          groupPointsCacheKey,
          groupPoints,
          (extraRef.current as { allGroupHeaderRefs?: IGroupHeaderRef[] } | undefined)
            ?.allGroupHeaderRefs
        );
    }
  }, [groupPoints, groupPointsCacheKey, view?.id, cacheEnabled]);
  const recordsScopeKey = useMemo(
    () =>
      JSON.stringify({
        initQuery,
        outerQuery,
      }),
    [initQuery, outerQuery]
  );
  // on a shared (non-personal) view the server resolves filter/sort (and
  // row-hiding search) through viewId, so they redefine the result set without
  // appearing in initQuery/outerQuery: the subscription stays alive and the
  // server pushes nothing when the new result set equals the old one. For those
  // changes the cache must keep the current page (still correct in that case)
  // and only drop the entries retained from the previous result set. Group and
  // personal-view changes also flow through outerQuery — the scope wipe handles
  // them and takes precedence in the combined effect below.
  const viewQueryScopeKey = useMemo(
    () =>
      JSON.stringify({
        viewId: view?.id,
        filter: view?.filter,
        sort: view?.sort,
        group: view?.group,
        search: hideNotMatchRow ? searchQuery : null,
      }),
    [view, hideNotMatchRow, searchQuery]
  );
  const [visiblePages, setVisiblePages] = useState<IRectangle>(defaultVisiblePages);
  const visiblePagesRef = useRef(visiblePages);
  visiblePagesRef.current = visiblePages;
  const previousRecordsScopeKeyRef = useRef(recordsScopeKey);
  const previousViewQueryScopeKeyRef = useRef(viewQueryScopeKey);
  const lastMergedSkipRef = useRef(0);
  const loadedRecordMapRef = useRef(loadedRecordMap);
  loadedRecordMapRef.current = loadedRecordMap;
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const cacheKeyRef = useRef(groupPointsCacheKey);
  cacheKeyRef.current = groupPointsCacheKey;
  const tableIdRef = useRef(tableId);
  tableIdRef.current = tableId;

  // true while the view has received at least one delivery for the current
  // scope: distinguishes "empty because not loaded yet" (keep the previous
  // snapshot) from "settled empty" (the previous snapshot is obsolete)
  const settledRef = useRef(false);
  // true between a scope switch and its first fresh delivery: that delivery
  // must REPLACE the seeded map instead of merging into it, or a shorter live
  // result would leave the stale snapshot tail on screen indefinitely
  // starts true: mount is equivalent to a scope switch — the first delivery
  // is authoritative and must replace any mount-time seed
  const pendingFreshRef = useRef(true);
  const cacheEnabledRef = useRef(cacheEnabled);
  cacheEnabledRef.current = cacheEnabled;

  const snapshotRows = useCallback((key: string) => {
    if (!cacheEnabledRef.current) return;
    const rows = collectFirstScreenRows(loadedRecordMapRef.current);
    if (rows.length) {
      useGridViewCacheStore.getState().setRows(key, rows);
    } else if (settledRef.current) {
      // the view settled with no records: evict the obsolete snapshot
      useGridViewCacheStore.getState().setRows(key, []);
    }
  }, []);

  // snapshot the view's first-screen rows when the grid unmounts (table
  // switch / route change), so returning to it can seed the first frame
  useEffect(() => {
    return () => snapshotRows(cacheKeyRef.current);
  }, [snapshotRows]);

  const onForceUpdate = useCallback(() => {
    const startIndex = queryRef.current.skip ?? 0;
    const take = queryRef.current.take ?? LOAD_PAGE_SIZE;
    lastMergedSkipRef.current = startIndex;
    const isFirstFreshDelivery = pendingFreshRef.current && (extra != null || records.length > 0);
    if (isFirstFreshDelivery) {
      pendingFreshRef.current = false;
    }
    if (extra != null) {
      settledRef.current = true;
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
      return newRecordsState;
    });

    if (extra != null) {
      setGroupPoints((extra as { groupPoints: IGroupPointsVo } | undefined)?.groupPoints ?? null);
    }
  }, [records, extra]);

  // layout effect to keep its declaration-order contract with the scope
  // effect below (merge first, wipe/seed second) now that both must flush
  // before paint — a passive merge would stomp the pre-paint seed
  useLayoutEffect(() => onForceUpdate(), [onForceUpdate]);

  const previousScopeCacheKeyRef = useRef(groupPointsCacheKey);
  // layout effect on purpose: it must run BEFORE the browser paints the
  // post-switch frame, otherwise one frame of "new view's columns × previous
  // view's rows" flashes on screen before the snapshot seed lands
  useLayoutEffect(() => {
    const recordsScopeChanged = previousRecordsScopeKeyRef.current !== recordsScopeKey;
    const viewQueryScopeChanged = previousViewQueryScopeKeyRef.current !== viewQueryScopeKey;
    const previousCacheKey = previousScopeCacheKeyRef.current;
    const cacheKeyChanged = previousCacheKey !== groupPointsCacheKey;
    previousRecordsScopeKeyRef.current = recordsScopeKey;
    previousViewQueryScopeKeyRef.current = viewQueryScopeKey;
    previousScopeCacheKeyRef.current = groupPointsCacheKey;

    const keySwitched = cacheEnabled && cacheKeyChanged;

    // leaving a view: snapshot its first-screen rows (plain data) so a later
    // switch back can render the last known state on the first frame
    if (keySwitched) {
      snapshotRows(previousCacheKey);
    }

    const seedTargetViewState = () => {
      const entry = useGridViewCacheStore.getState().cacheMap[groupPointsCacheKey];
      setLoadedRecordMap(
        buildSeededRecordMap(entry?.rows, fieldsRef.current, tableIdRef.current) ?? {}
      );
      setGroupPoints(entry?.groupPoints ?? null);
    };

    // a scope change re-creates the subscription, which always delivers a fresh
    // ready event. On a view switch, seed the target view's last known rows and
    // group structure (session cache) — the fresh data overwrites them on ready;
    // a same-view scope change (e.g. editing the group config) has no valid
    // last-known state, so it drops to the loading placeholders
    if (recordsScopeChanged) {
      settledRef.current = false;
      pendingFreshRef.current = true;
      if (keySwitched) {
        seedTargetViewState();
      } else {
        setLoadedRecordMap({});
        setGroupPoints(null);
      }
      setVisiblePages(defaultVisiblePages);
      return;
    }

    if (!viewQueryScopeChanged) return;

    // a view switch can land here too (same records scope, new viewId): the
    // rows on screen belong to the previous view, and its order/filter may
    // differ — never keep another view's data; seed the target view's snapshot
    // or fall back to loading placeholders
    if (cacheKeyChanged) {
      settledRef.current = false;
      pendingFreshRef.current = true;
      if (keySwitched) {
        seedTargetViewState();
      } else {
        setLoadedRecordMap({});
        setGroupPoints(null);
      }
      return;
    }

    // same-view query change (filter/sort edits): the subscription stays alive
    // and the server pushes nothing when the new result set equals the old one
    // — keep the current page (still correct in that case, diff events
    // overwrite it otherwise) and only drop the retained entries
    const startIndex = lastMergedSkipRef.current;
    setLoadedRecordMap(() =>
      records.reduce((acc, record, i) => {
        acc[startIndex + i] = record;
        return acc;
      }, {} as IRecordIndexMap)
    );
  }, [
    recordsScopeKey,
    viewQueryScopeKey,
    records,
    extra,
    groupPointsCacheKey,
    cacheEnabled,
    snapshotRows,
  ]);

  useEffect(() => {
    const { y, height } = visiblePages;
    setQuery((cv) => {
      if (cv.skip === undefined) {
        return cv;
      }

      const next = computeNextWindowQuery(cv, y, height, initQuery?.take ?? LOAD_PAGE_SIZE);
      if (next) {
        return {
          ...initQuery,
          ...next,
        };
      }
      return {
        take: cv.take,
        ...initQuery,
        skip: cv.skip,
      };
    });
  }, [visiblePages, initQuery]);

  const updateVisiblePages = useMemo(() => {
    return debounce(setVisiblePages, 30, { maxWait: 500 });
  }, []);

  const onVisibleRegionChanged: NonNullable<IGridProps['onVisibleRegionChanged']> = useCallback(
    (r) => {
      const { y, height } = visiblePagesRef.current;
      if (r.y === y && r.height === height) return;
      updateVisiblePages(r);
    },
    [updateVisiblePages]
  );

  const onReset = useCallback(() => {
    // callers reset on table switches, AFTER the scope effect above has
    // already seeded the target view — resetting to the same seed (instead of
    // a blind {}) keeps the snapshot optimization alive on those paths
    const seeded = cacheEnabledRef.current
      ? buildSeededRecordMap(
          useGridViewCacheStore.getState().cacheMap[cacheKeyRef.current]?.rows,
          fieldsRef.current,
          tableIdRef.current
        )
      : undefined;
    setLoadedRecordMap(seeded ?? {});
    setVisiblePages(defaultVisiblePages);
  }, []);

  // reactive read so cached refs keep group collapse/expand menus functional
  // while cached headers are shown ahead of the live subscription
  const cachedGroupHeaderRefs = useGridViewCacheStore((state) =>
    cacheEnabled ? state.cacheMap[groupPointsCacheKey]?.groupHeaderRefs : undefined
  );

  return {
    groupPoints,
    allGroupHeaderRefs:
      (extra as { allGroupHeaderRefs: IGroupHeaderRef[] })?.allGroupHeaderRefs ??
      cachedGroupHeaderRefs ??
      null,
    recordMap: loadedRecordMap,
    onVisibleRegionChanged,
    recordsQuery,
    onForceUpdate,
    onReset,
    searchHitIndex,
  };
};
