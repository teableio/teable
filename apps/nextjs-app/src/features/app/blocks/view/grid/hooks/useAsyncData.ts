import type { IRecord, IRecordSnapshotQuery } from '@teable-group/core';
import { useRecords, useRowCount, useViewId } from '@teable-group/sdk';
import type { Record } from '@teable-group/sdk/model';
import { inRange, debounce } from 'lodash';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { ICellItem, IGridProps, IRectangle } from '../../../grid';
import type { ICell, IInnerCell } from '../../../grid/renderers';
import { CellType } from '../../../grid/renderers';
import { reorder } from '../utils';

const defaultVisiblePages = { x: 0, y: 0, width: 0, height: 0 };
// eslint-disable-next-line @typescript-eslint/naming-convention
const PAGE_SIZE = 300;

export type IRowCallback<T> = (range: ICellItem) => Promise<readonly T[]>;
export type IRowToCell<T> = (row: T, col: number) => ICell;
export type IRowEditedCallback<T> = (
  cell: ICellItem,
  newVal: IInnerCell,
  record: T
) => T | undefined;

type IRes = {
  recordMap: IRecordIndexMap;
  reset: () => void;
  onRowOrdered: (rowIndexCollection: number[], newRowIndex: number) => void;
  onCellEdited: (cell: ICellItem, newValue: IInnerCell) => void;
  getCellContent: (cell: ICellItem) => ICell;
  onVisibleRegionChanged: NonNullable<IGridProps['onVisibleRegionChanged']>;
};

export type IRecordIndexMap = { [i: number | string]: Record };

export const useAsyncData = (
  toCell: IRowToCell<Record>,
  onEdited: IRowEditedCallback<Record>,
  initRecords?: IRecord[]
): IRes => {
  const [query, setQuery] = useState<Omit<IRecordSnapshotQuery, 'type'>>({
    offset: 0,
    limit: PAGE_SIZE,
  });
  const viewId = useViewId();
  const rowCount = useRowCount();
  const queryRef = useRef(query);
  queryRef.current = query;
  const records = useRecords(query, initRecords);
  const [loadedRecords, setLoadedRecords] = useState<IRecordIndexMap>(() =>
    records.reduce((acc, record, i) => {
      acc[i] = record;
      return acc;
    }, {} as IRecordIndexMap)
  );
  const [visiblePages, setVisiblePages] = useState<IRectangle>(defaultVisiblePages);
  const visiblePagesRef = useRef(visiblePages);
  visiblePagesRef.current = visiblePages;

  useEffect(() => {
    const startIndex = queryRef.current.offset ?? 0;
    const data = records;
    setLoadedRecords((preLoadedRecords) => {
      const cacheLen = PAGE_SIZE * 2;
      const [cacheStartIndex, cacheEndIndex] = [
        Math.max(startIndex - cacheLen / 2, 0),
        startIndex + data.length + cacheLen / 2,
      ];
      const newRecordsState: IRecordIndexMap = {};
      for (let i = cacheStartIndex; i < cacheEndIndex; i++) {
        if (startIndex <= i && i < startIndex + data.length) {
          newRecordsState[i] = data[i - startIndex];
          continue;
        }
        newRecordsState[i] = preLoadedRecords[i];
      }
      return newRecordsState;
    });
  }, [records]);

  useEffect(() => {
    const { y, height } = visiblePages;
    setQuery((cv) => {
      if (cv.offset === undefined) {
        return cv;
      }

      const pageOffsetSize = PAGE_SIZE / 3;
      const pageGap = PAGE_SIZE / 3;

      const visibleStartIndex =
        cv.offset <= y ? cv.offset - pageOffsetSize : cv.offset + pageOffsetSize;
      const visibleEndIndex = visibleStartIndex + PAGE_SIZE;
      const viewInRange =
        inRange(y, visibleStartIndex, visibleEndIndex) &&
        inRange(y + height, visibleStartIndex, visibleEndIndex);
      if (!viewInRange) {
        const offset = Math.floor(y / pageGap) * pageGap - pageGap;
        return {
          ...cv,
          offset: Math.max(0, offset),
        };
      }
      return cv;
    });
  }, [visiblePages]);

  const updateVisiblePages = useMemo(() => {
    return debounce(setVisiblePages, 30);
  }, []);

  const onVisibleRegionChanged: NonNullable<IGridProps['onVisibleRegionChanged']> = useCallback(
    (r) => {
      const { y, height } = visiblePagesRef.current;
      if (r.y === y && r.height === height) return;
      updateVisiblePages(r);
    },
    [updateVisiblePages]
  );

  const onCellEdited = useCallback(
    (cell: ICellItem, newVal: IInnerCell) => {
      const [, row] = cell;
      const record = loadedRecords[row];
      if (record === undefined) return;
      onEdited(cell, newVal, record);
    },
    [onEdited, loadedRecords]
  );

  const getCellContent = useCallback<(cell: ICellItem) => ICell>(
    (cell) => {
      const [colIndex, rowIndex] = cell;
      const rowData = loadedRecords[rowIndex];
      if (rowData !== undefined) {
        return toCell(rowData, colIndex);
      }
      return {
        type: CellType.Loading,
      };
    },
    [toCell, loadedRecords]
  );

  const reset = useCallback(() => {
    setLoadedRecords({});
    setVisiblePages(defaultVisiblePages);
  }, []);

  const onRowOrdered = useCallback(
    (rowIndexCollection: number[], newRowIndex: number) => {
      const operationRecords: Record[] = [];

      for (const rowIndex of rowIndexCollection) {
        const record = loadedRecords[rowIndex];
        if (!record) {
          throw new Error('Can not find record by index: ' + rowIndex);
        }
        operationRecords.push(record);
      }
      const targetRecord = loadedRecords[newRowIndex];

      if (!targetRecord) {
        throw new Error('Can not find target record by index: ' + newRowIndex);
      }

      if (!viewId) {
        throw new Error('Can not find view id');
      }

      const newOrders = reorder(
        rowIndexCollection,
        newRowIndex,
        rowCount ?? Object.keys(loadedRecords)?.length,
        (index) => {
          return loadedRecords[index].recordOrder[viewId];
        }
      );

      operationRecords.forEach((record, index) => {
        record.updateRecordOrder(viewId, newOrders[index]);
      });
    },
    [loadedRecords, viewId, rowCount]
  );

  return {
    getCellContent,
    onVisibleRegionChanged,
    onCellEdited,
    onRowOrdered,
    recordMap: loadedRecords,
    reset,
  };
};
