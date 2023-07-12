import type { IRecordSnapshot, IRecordSnapshotQuery } from '@teable-group/core';
import { useRecords } from '@teable-group/sdk/hooks';
import type { Record } from '@teable-group/sdk/model';
import { inRange } from 'lodash';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ICellItem, IRectangle } from '../../../grid';
import type { IInnerCell } from '../../../grid/renderers';
import { CellType } from '../../../grid/renderers';

export type IRowCallback<T> = (range: ICellItem) => Promise<readonly T[]>;
export type IRowToCell<T> = (row: T, col: number) => IInnerCell;
export type IRowEditedCallback<T> = (
  cell: ICellItem,
  newVal: IInnerCell,
  record: T
) => T | undefined;

type IRes = {
  records: Record[];
  reset: () => void;
  onCellEdited: (cell: ICellItem, newValue: IInnerCell) => void;
  getCellContent: (cell: ICellItem) => IInnerCell;
};

export const useAsyncData = (
  toCell: IRowToCell<Record>,
  onEdited: IRowEditedCallback<Record>,
  initRecords?: IRecordSnapshot[]
): IRes => {
  const [query, setQuery] = useState<Omit<IRecordSnapshotQuery, 'type'>>({
    offset: 0,
    limit: 150,
  });
  const queryRef = useRef(query);
  queryRef.current = query;
  const records = useRecords(query, initRecords);
  const recordsRef = useRef(records);

  const [visiblePages] = useState<IRectangle>({ x: 0, y: 0, width: 0, height: 0 });
  const visiblePagesRef = useRef(visiblePages);
  visiblePagesRef.current = visiblePages;

  useEffect(() => {
    const startIndex = queryRef.current.offset ?? 0;
    // const vr = visiblePagesRef.current;
    // const damageList: { cell: [number, number] }[] = [];
    const data = records;
    for (let i = 0; i < data.length; i++) {
      recordsRef.current[startIndex + i] = records[i];
      // for (let col = Math.max(vr.x - 1, 0); col <= vr.x + vr.width; col++) {
      //   // damageList.push({
      //   //   cell: [col, i + startIndex],
      //   // });
      // }
    }
    // gridRef.current?.updateCells?.(damageList);
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

  // const onVisibleRegionChanged = useCallback((r) => {
  //   setVisiblePages((cv) => {
  //     if (r.x === cv.x && r.y === cv.y && r.width === cv.width && r.height === cv.height) return cv;
  //     return r;
  //   });
  // }, []);

  // const onCellEdited = useCallback(
  //   (cell: ICellItem, newVal: EditableGridCell) => {
  //     const [, row] = cell;
  //     const current = recordsRef.current[row];
  //     if (current === undefined) return;

  //     const result = onEdited(cell, newVal, current);
  //     if (result !== undefined) {
  //       recordsRef.current[row] = result;
  //     }
  //   },
  //   [onEdited]
  // );

  const onCellEdited = useCallback(
    (cell: ICellItem, newVal: IInnerCell) => {
      const [, row] = cell;
      const current = recordsRef.current[row];
      if (current === undefined) return;

      const result = onEdited(cell, newVal, current);
      if (result !== undefined) {
        recordsRef.current[row] = result;
      }
    },
    [onEdited]
  );

  const getCellContent = useCallback<(cell: ICellItem) => IInnerCell>(
    (cell) => {
      const [col, row] = cell;
      const rowData = recordsRef.current[row];
      if (rowData !== undefined) {
        return toCell(rowData, col);
      }
      return {
        type: CellType.Text,
        data: '',
        displayData: '',
        copyData: '#Loading',
        allowOverlay: false,
      };
    },
    [toCell]
  );

  const reset = useCallback(() => {
    recordsRef.current = [];
  }, []);

  return {
    getCellContent,
    // onVisibleRegionChanged,
    onCellEdited,
    records,
    reset,
  };
};
