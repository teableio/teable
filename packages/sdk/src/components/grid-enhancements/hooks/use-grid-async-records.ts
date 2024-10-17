import type { IRecord } from '@teable/core';
import type { IGetRecordsRo, IGroupPointsVo } from '@teable/openapi';
import { inRange, debounce } from 'lodash';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { IGridProps, IRectangle } from '../..';
import { useRecords } from '../../../hooks/use-records';
import type { Record } from '../../../model';

// eslint-disable-next-line
export const LOAD_PAGE_SIZE = 300;
const defaultVisiblePages = { x: 0, y: 0, width: 0, height: 0 };

type IRes = {
  groupPoints: IGroupPointsVo | null;
  recordMap: IRecordIndexMap;
  onReset: () => void;
  onForceUpdate: () => void;
  recordsQuery: IGetRecordsRo;
  onVisibleRegionChanged: NonNullable<IGridProps['onVisibleRegionChanged']>;
};

export type IRecordIndexMap = { [i: number | string]: Record };

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
  const { records, extra } = useRecords(recordsQuery, initRecords);
  const [loadedRecordMap, setLoadedRecordMap] = useState<IRecordIndexMap>(() =>
    records.reduce((acc, record, i) => {
      acc[i] = record;
      return acc;
    }, {} as IRecordIndexMap)
  );
  const [groupPoints, setGroupPoints] = useState<IGroupPointsVo>(
    () =>
      (extra == null
        ? initGroupPoints
        : (extra as { groupPoints: IGroupPointsVo } | undefined)?.groupPoints) ?? null
  );
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
          newRecordsState[i] = records[i - startIndex];
          continue;
        }
        newRecordsState[i] = preLoadedRecords[i];
      }
      return newRecordsState;
    });

    if (extra != null) {
      setGroupPoints((extra as { groupPoints: IGroupPointsVo } | undefined)?.groupPoints ?? null);
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
    setVisiblePages(defaultVisiblePages);
  }, []);

  return {
    groupPoints,
    recordMap: loadedRecordMap,
    onVisibleRegionChanged,
    recordsQuery,
    onForceUpdate,
    onReset,
  };
};
