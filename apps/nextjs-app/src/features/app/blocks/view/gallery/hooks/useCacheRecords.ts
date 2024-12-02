import { arrayMove } from '@dnd-kit/sortable';
import type { IGetRecordsRo } from '@teable/openapi';
import { useRecords } from '@teable/sdk/hooks';
import type { Record as RecordModel } from '@teable/sdk/model';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

interface UseVirtualRecordsReturn {
  skip: number;
  recordIds: string[];
  loadedRecordMap: Record<number, RecordModel>;
  updateSkipIndex: (startIndex: number, rowCount: number, overscan?: number) => void;
  updateRecordOrder: (oldIndex: number, newIndex: number) => void;
}

const DEFAULT_TAKE = 300;
const CACHE_COUNT = 800;

export const useCacheRecords = (
  query: Pick<IGetRecordsRo, 'filter' | 'orderBy'> | undefined
): UseVirtualRecordsReturn => {
  const [skip, setSkip] = useState(0);
  const recordQuery = useMemo(() => {
    return {
      ...query,
      skip,
      take: DEFAULT_TAKE,
    };
  }, [query, skip]);

  const { records } = useRecords(recordQuery);

  const [loadedRecordMap, setLoadedRecordMap] = useState<Record<number, RecordModel>>({});
  const [recordIds, setRecordIds] = useState<string[]>(records.map((r) => r.id));
  const skipIndexRef = useRef(skip);

  useEffect(() => {
    setLoadedRecordMap((prev) => {
      const cacheStartIndex = Math.max(skipIndexRef.current - CACHE_COUNT / 2, 0);
      const cacheEndIndex = skipIndexRef.current + CACHE_COUNT / 2;
      const newRecordMap: Record<string, RecordModel> = {};

      for (let i = cacheStartIndex; i < cacheEndIndex; i++) {
        newRecordMap[i] = records[i - skipIndexRef.current] ?? prev[i];
      }
      return newRecordMap;
    });
  }, [records]);

  useEffect(() => {
    if (!records.length) return;
    setRecordIds(records.map((r) => r.id));
  }, [records]);

  useEffect(() => {
    skipIndexRef.current = skip;
  }, [skip]);

  const updateSkipIndex = useCallback(
    (startIndex: number, rowCount: number, overscan: number = 100) => {
      let newSkip = Math.floor(startIndex / DEFAULT_TAKE) * DEFAULT_TAKE;
      const actualEndIndex = newSkip + DEFAULT_TAKE;

      if (actualEndIndex - startIndex < overscan) {
        newSkip = Math.max(newSkip + overscan, 0);
      }

      if (newSkip >= rowCount) return;

      skipIndexRef.current = newSkip;
      setSkip(newSkip);
    },
    []
  );

  const updateRecordOrder = useCallback(
    (oldIndex: number, newIndex: number) => {
      const newRecordIds = arrayMove(recordIds, oldIndex, newIndex);

      setRecordIds(newRecordIds);
      setLoadedRecordMap((prev) => {
        const newRecordMap = { ...prev };
        const minIndex = Math.min(...Object.keys(prev).map(Number));
        const maxIndex = Math.max(...Object.keys(prev).map(Number));
        if (oldIndex > newIndex) {
          const record = prev[oldIndex];
          const endIndex = Math.min(oldIndex, maxIndex);
          for (let i = endIndex - 1; i >= newIndex; i--) {
            newRecordMap[i + 1] = prev[i];
          }
          newRecordMap[newIndex] = record;
        } else {
          const record = prev[oldIndex];
          const startIndex = Math.max(oldIndex, minIndex);
          for (let i = startIndex + 1; i <= newIndex; i++) {
            newRecordMap[i - 1] = prev[i];
          }
          newRecordMap[newIndex] = record;
        }
        return newRecordMap;
      });
    },
    [recordIds]
  );

  return {
    skip,
    recordIds,
    loadedRecordMap,
    updateSkipIndex,
    updateRecordOrder,
  };
};
