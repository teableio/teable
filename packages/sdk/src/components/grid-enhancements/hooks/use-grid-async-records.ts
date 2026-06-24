import type { IRecord, ISearchHitIndex } from '@teable/core';
import { computeSearchHitIndex } from '@teable/core';
import type { IGetRecordsRo, IGroupHeaderRef, IGroupPointsVo } from '@teable/openapi';
import { inRange, debounce } from 'lodash';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { IGridProps, IRectangle } from '../..';
import { useFields, useSearch, useView } from '../../../hooks';
import { useRecords } from '../../../hooks/use-records';
import type { Record as IRecordInstance } from '../../../model';

// eslint-disable-next-line
export const LOAD_PAGE_SIZE = 300;
const defaultVisiblePages = { x: 0, y: 0, width: 0, height: 0 };

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
    take: LOAD_PAGE_SIZE,
    ...initQuery,
  });
  const recordsQuery = useMemo(() => ({ ...query, ...outerQuery }), [query, outerQuery]);
  const queryRef = useRef(query);
  queryRef.current = query;

  const view = useView();
  const { searchQuery, hideNotMatchRow } = useSearch();
  const fields = useFields();
  const { records, extra } = useRecords(recordsQuery, initRecords);
  const [loadedRecordMap, setLoadedRecordMap] = useState<IRecordIndexMap>(() =>
    records.reduce((acc, record, i) => {
      acc[i] = record;
      return acc;
    }, {} as IRecordIndexMap)
  );

  const searchHitIndex = useMemo<ISearchHitIndex | undefined>(
    () => computeSearchHitIndex(Object.values(loadedRecordMap), fields, searchQuery),
    [loadedRecordMap, fields, searchQuery]
  );

  const [groupPoints, setGroupPoints] = useState<IGroupPointsVo>(
    () =>
      (extra == null
        ? initGroupPoints
        : (extra as { groupPoints: IGroupPointsVo } | undefined)?.groupPoints) ?? null
  );
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

  const onForceUpdate = useCallback(() => {
    const startIndex = queryRef.current.skip ?? 0;
    const take = queryRef.current.take ?? LOAD_PAGE_SIZE;
    lastMergedSkipRef.current = startIndex;
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

  useEffect(() => onForceUpdate(), [onForceUpdate]);

  useEffect(() => {
    const recordsScopeChanged = previousRecordsScopeKeyRef.current !== recordsScopeKey;
    const viewQueryScopeChanged = previousViewQueryScopeKeyRef.current !== viewQueryScopeKey;
    previousRecordsScopeKeyRef.current = recordsScopeKey;
    previousViewQueryScopeKeyRef.current = viewQueryScopeKey;

    // a scope change re-creates the subscription, which always delivers a fresh
    // ready event — drop everything and show the loading state. This must win
    // over the seed below: group and personal-view changes flip both keys at once
    if (recordsScopeChanged) {
      setLoadedRecordMap({});
      setGroupPoints(null);
      setVisiblePages(defaultVisiblePages);
      return;
    }

    if (!viewQueryScopeChanged) return;

    // view-query-only change: the subscription stays alive and the server pushes
    // nothing when the new result set equals the old one — keep the current page
    // (still correct in that case, diff events overwrite it otherwise) and only
    // drop the entries retained from the previous result set
    const startIndex = lastMergedSkipRef.current;
    setLoadedRecordMap(() =>
      records.reduce((acc, record, i) => {
        acc[startIndex + i] = record;
        return acc;
      }, {} as IRecordIndexMap)
    );
  }, [recordsScopeKey, viewQueryScopeKey, records, extra]);

  useEffect(() => {
    const { y, height } = visiblePages;
    setQuery((cv) => {
      if (cv.skip === undefined) {
        return cv;
      }

      const take = initQuery?.take ?? cv.take ?? LOAD_PAGE_SIZE;

      const pageOffsetSize = take / 3;
      const pageGap = take / 3;

      const visibleStartIndex = cv.skip <= y ? cv.skip - pageOffsetSize : cv.skip + pageOffsetSize;
      const visibleEndIndex = visibleStartIndex + take;
      const viewInRange =
        inRange(y, visibleStartIndex, visibleEndIndex) &&
        inRange(y + height, visibleStartIndex, visibleEndIndex);
      if (!viewInRange) {
        const skip = Math.floor(y / pageGap) * pageGap - pageGap;
        return {
          take: cv.take,
          ...initQuery,
          skip: Math.max(0, skip),
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
    setLoadedRecordMap({});
    setVisiblePages(defaultVisiblePages);
  }, []);

  return {
    groupPoints,
    allGroupHeaderRefs:
      (extra as { allGroupHeaderRefs: IGroupHeaderRef[] })?.allGroupHeaderRefs ?? null,
    recordMap: loadedRecordMap,
    onVisibleRegionChanged,
    recordsQuery,
    onForceUpdate,
    onReset,
    searchHitIndex,
  };
};
