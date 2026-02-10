import type { IGetRecordsRo } from '@teable/openapi';
import { inRange, debounce, get } from 'lodash';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { IGridProps, IRectangle } from '../..';
import { useSearch } from '../../../hooks';
import { useRecordsQuery } from '../../../hooks/use-records-query';
import {
  type ISearchHits,
  type IRecordIndexMap,
  type IRecordSearchHitIndex,
  type IRecordSearchHitIndexMap,
  LOAD_PAGE_SIZE,
} from './use-grid-async-records';

type IRes = {
  searchHitIndex?: { fieldId: string; recordId: string }[];
  recordMap: IRecordIndexMap;
  recordsQuery: IGetRecordsRo;
  isQuerying: boolean;
  onReset: () => void;
  onForceUpdate: () => void;
  onVisibleRegionChanged: NonNullable<IGridProps['onVisibleRegionChanged']>;
};

const defaultVisiblePages = { x: 0, y: 0, width: 0, height: 0 };

const getRecordSearchHitIndex = (extra: unknown) => {
  const searchHitIndex = get(extra, 'searchHitIndex') as ISearchHits | undefined;
  if (!searchHitIndex || !searchHitIndex.length) {
    return [] as IRecordSearchHitIndex;
  }

  const groupedIndexes = [] as IRecordSearchHitIndex;
  searchHitIndex.forEach((item) => {
    const index = groupedIndexes.findIndex((group) => group.recordId === item.recordId);
    if (index > -1) {
      groupedIndexes[index] = {
        recordId: item.recordId,
        fieldId: [...groupedIndexes[index].fieldId, item.fieldId],
      };
    } else {
      groupedIndexes.push({
        recordId: item.recordId,
        fieldId: [item.fieldId],
      });
    }
  });
  return groupedIndexes;
};

const getRecordSearchHitIndexMap = (extra: unknown) => {
  const groupedSearchHitIndex = getRecordSearchHitIndex(extra);
  return groupedSearchHitIndex.reduce((acc, item, index) => {
    acc[index] = item;
    return acc;
  }, {} as IRecordSearchHitIndexMap);
};

const getSearchHitIndexFromRecordMap = (
  groupedSearchHitIndexMap: IRecordSearchHitIndexMap | undefined
) => {
  if (!groupedSearchHitIndexMap || Object.values(groupedSearchHitIndexMap).length === 0) {
    return undefined;
  }
  return Object.values(groupedSearchHitIndexMap)
    .filter((item) => !!item)
    .flatMap((item) => item.fieldId.map((fieldId) => ({ fieldId, recordId: item.recordId })));
};

export const useGridAsyncRecordsQuery = (
  initQuery?: IGetRecordsRo,
  outerQuery?: Pick<IGetRecordsRo, 'filter' | 'orderBy' | 'groupBy' | 'collapsedGroupIds'>
): IRes => {
  const [query, setQuery] = useState<IGetRecordsRo>({
    skip: 0,
    take: LOAD_PAGE_SIZE,
    ...initQuery,
  });
  const recordsQuery = useMemo(() => ({ ...query, ...outerQuery }), [query, outerQuery]);
  const queryRef = useRef(query);
  queryRef.current = query;

  const { searchQuery } = useSearch();
  const [searchValue, searchFields] = searchQuery || [];
  const { records, extra, isLoading, isFetching } = useRecordsQuery(recordsQuery, true);
  const isQuerying = isLoading || isFetching;
  const [loadedRecordMap, setLoadedRecordMap] = useState<IRecordIndexMap>(() =>
    records.reduce((acc, record, i) => {
      acc[i] = record;
      return acc;
    }, {} as IRecordIndexMap)
  );

  const [loadedRecordSearchHitMap, setLoadedRecordSearchHitMap] = useState<
    IRecordSearchHitIndexMap | undefined
  >(() => {
    return getRecordSearchHitIndexMap(extra);
  });

  const loadedSearchHitIndex = useMemo<ISearchHits | undefined>(() => {
    return getSearchHitIndexFromRecordMap(loadedRecordSearchHitMap);
  }, [loadedRecordSearchHitMap]);

  const [visiblePages, setVisiblePages] = useState<IRectangle>(defaultVisiblePages);
  const visiblePagesRef = useRef(visiblePages);
  visiblePagesRef.current = visiblePages;

  const onForceUpdate = useCallback(() => {
    const startIndex = queryRef.current.skip ?? 0;
    const take = queryRef.current.take ?? LOAD_PAGE_SIZE;
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

    if (get(extra, 'searchHitIndex')) {
      setLoadedRecordSearchHitMap((preLoadedRecords) => {
        if (!preLoadedRecords || Object.values(preLoadedRecords).length === 0) {
          return getRecordSearchHitIndexMap(extra);
        }

        const indexes = getRecordSearchHitIndex(extra);
        const cacheLen = take * 2;
        const [cacheStartIndex, cacheEndIndex] = [
          Math.max(startIndex - cacheLen / 2, 0),
          startIndex + indexes.length + cacheLen / 2,
        ];

        const newRecordsState: Record<string, IRecordSearchHitIndex[number]> = {};
        for (let i = cacheStartIndex; i < cacheEndIndex; i++) {
          if (startIndex <= i && i < startIndex + indexes.length) {
            const indexRecord = indexes[i - startIndex];
            if (indexRecord !== undefined) {
              newRecordsState[i] = indexRecord;
            }
            continue;
          }
          const cachedSearchHitRecord = preLoadedRecords[i];
          if (cachedSearchHitRecord !== undefined) {
            newRecordsState[i] = cachedSearchHitRecord;
          }
        }
        return newRecordsState;
      });
    }
  }, [records, extra]);

  useEffect(() => onForceUpdate(), [onForceUpdate]);

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
    setLoadedRecordSearchHitMap(undefined);
    setVisiblePages(defaultVisiblePages);
  }, []);

  useEffect(() => {
    setLoadedRecordSearchHitMap(undefined);
  }, [searchFields, searchValue]);

  return {
    recordMap: loadedRecordMap,
    recordsQuery,
    searchHitIndex: loadedSearchHitIndex,
    isQuerying,
    onReset,
    onForceUpdate,
    onVisibleRegionChanged,
  };
};
