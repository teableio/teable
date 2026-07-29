import type { IRecord } from '@teable/core';
import type { IGetRecordsRo } from '@teable/openapi';
import { debounce } from 'lodash';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { Record } from '../model';
import {
  computeNextWindowQuery,
  INITIAL_LOAD_PAGE_SIZE,
  LOAD_PAGE_SIZE,
} from '../utils/record-window';
import { useRecords } from './use-records';

export { INITIAL_LOAD_PAGE_SIZE, LOAD_PAGE_SIZE };
const defaultVisiblePages = { y: 0, height: 0 };

interface IVisiblePages {
  y: number;
  height: number;
}

type IRes = {
  recordMap: IRecordIndexMap;
  onReset: () => void;
  onForceUpdate: () => void;
  onVisibleRegionChanged: (r: IVisiblePages) => void;
};

export type IRecordIndexMap = { [i: number | string]: Record };

export const useInfiniteRecords = (
  recordsQuery?: Omit<IGetRecordsRo, 'take' | 'skip'>,
  initRecords?: IRecord[]
): IRes => {
  const [query, setQuery] = useState<IGetRecordsRo>({
    skip: 0,
    take: INITIAL_LOAD_PAGE_SIZE,
    ...recordsQuery,
  });
  const queryRef = useRef(query);
  queryRef.current = query;
  const { records } = useRecords(query, initRecords);
  const [loadedRecordMap, setLoadedRecordMap] = useState<IRecordIndexMap>(() =>
    records.reduce((acc, record, i) => {
      acc[i] = record;
      return acc;
    }, {} as IRecordIndexMap)
  );
  const [visiblePages, setVisiblePages] = useState<IVisiblePages>(defaultVisiblePages);
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
  }, [records]);

  useEffect(() => onForceUpdate(), [onForceUpdate]);

  useEffect(() => {
    const { y, height } = visiblePages;
    setQuery((cv) => {
      if (cv.skip === undefined) {
        return cv;
      }

      const next = computeNextWindowQuery(cv, y, height);
      if (next) {
        return {
          ...recordsQuery,
          ...next,
        };
      }
      return {
        take: cv.take,
        ...recordsQuery,
        skip: cv.skip,
      };
    });
  }, [visiblePages, recordsQuery]);

  const updateVisiblePages = useMemo(() => {
    return debounce(setVisiblePages, 30, { maxWait: 500 });
  }, []);

  const onVisibleRegionChanged = useCallback(
    (r: IVisiblePages) => {
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
    recordMap: loadedRecordMap,
    onVisibleRegionChanged,
    onForceUpdate,
    onReset,
  };
};
