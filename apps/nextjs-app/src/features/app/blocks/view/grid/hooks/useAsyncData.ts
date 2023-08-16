import type { IRecord, IRecordSnapshotQuery } from '@teable-group/core';
import { useRecords, useViewId } from '@teable-group/sdk';
import type { Record } from '@teable-group/sdk/model';
import { inRange } from 'lodash';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ICellItem, IGridProps, IRectangle } from '../../../grid';
import type { ICell, IInnerCell } from '../../../grid/renderers';
import { CellType } from '../../../grid/renderers';
import { reorder } from '../utils';

const defaultVisiblePages = { x: 0, y: 0, width: 0, height: 0 };

export type IRowCallback<T> = (range: ICellItem) => Promise<readonly T[]>;
export type IRowToCell<T> = (row: T, col: number) => ICell;
export type IRowEditedCallback<T> = (
  cell: ICellItem,
  newVal: IInnerCell,
  record: T
) => T | undefined;

type IRes = {
  records: Record[];
  reset: () => void;
  onRowOrdered: (rowIndexCollection: number[], newRowIndex: number) => void;
  onCellEdited: (cell: ICellItem, newValue: IInnerCell) => void;
  getCellContent: (cell: ICellItem) => ICell;
  onVisibleRegionChanged: NonNullable<IGridProps['onVisibleRegionChanged']>;
};

export const useAsyncData = (
  toCell: IRowToCell<Record>,
  onEdited: IRowEditedCallback<Record>,
  initRecords?: IRecord[]
): IRes => {
  const [query, setQuery] = useState<Omit<IRecordSnapshotQuery, 'type'>>({
    offset: 0,
    limit: 150,
  });
  const viewId = useViewId();
  const queryRef = useRef(query);
  queryRef.current = query;
  const records = useRecords(query, initRecords);
  const [loadedRecords, setLoadedRecords] = useState<Record[]>(records);

  const [visiblePages, setVisiblePages] = useState<IRectangle>(defaultVisiblePages);
  const visiblePagesRef = useRef(visiblePages);
  visiblePagesRef.current = visiblePages;

  useEffect(() => {
    const startIndex = queryRef.current.offset ?? 0;
    const data = records;
    setLoadedRecords((prevLoadedRecords) => {
      const newRecordsState: Record[] = [...prevLoadedRecords];
      for (let i = 0; i < data.length; i++) {
        newRecordsState[startIndex + i] = records[i];
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

      const visibleStartIndex = cv.offset <= y ? cv.offset - 50 : cv.offset + 50;
      const visibleEndIndex = visibleStartIndex + 150;
      const viewInRange =
        inRange(y, visibleStartIndex, visibleEndIndex) &&
        inRange(y + height, visibleStartIndex, visibleEndIndex);
      if (!viewInRange) {
        const offset = Math.floor(y / 25) * 25 - 25;
        return {
          ...cv,
          offset: Math.max(0, offset),
        };
      }
      return cv;
    });
  }, [visiblePages]);

  const onVisibleRegionChanged: NonNullable<IGridProps['onVisibleRegionChanged']> = useCallback(
    (r) => {
      const { y, height } = visiblePagesRef.current;
      if (r.y === y && r.height === height) return;
      setVisiblePages(r);
    },
    []
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
    setLoadedRecords([]);
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

      const newOrders = reorder(rowIndexCollection, newRowIndex, loadedRecords.length, (index) => {
        return loadedRecords[index].recordOrder[viewId];
      });

      operationRecords.forEach((record, index) => {
        record.updateRecordOrder(viewId, newOrders[index]);
      });
    },
    [loadedRecords, viewId]
  );

  return {
    getCellContent,
    onVisibleRegionChanged,
    onCellEdited,
    onRowOrdered,
    records: loadedRecords,
    reset,
  };
};
