import { useMutation } from '@tanstack/react-query';
import type { IGetRecordsRo } from '@teable/openapi';
import { getRecordStatus, saveQueryParams } from '@teable/openapi';
import { isEqual } from 'lodash';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFields, useRecord, useTableId, useViewId } from '../../../hooks';
import type { Record as IRecord } from '../../../model';
import type { IGridRef } from '../../grid/Grid';
import type { ICell, ICellItem, IGridColumn, IInnerCell, IRange } from '../../grid/interface';
import { CellType, SelectionRegionType } from '../../grid/interface';
import { CombinedSelection, emptySelection } from '../../grid/managers';
import { useGridViewStore } from '../store/useGridViewStore';
import { isNeedPersistEditing } from '../utils/persist-editing';
import { LARGE_QUERY_THRESHOLD } from './constant';
import { useCreateCellValue2GridDisplay } from './use-grid-columns';

interface IUseGridSelectionProps {
  recordMap: Record<string, IRecord>;
  columns: (IGridColumn & {
    id: string;
  })[];
  viewQuery?: Pick<IGetRecordsRo, 'filter' | 'orderBy' | 'groupBy' | 'collapsedGroupIds'>;
  gridRef: React.RefObject<IGridRef>;
}

export interface IActiveCell {
  recordId: string;
  fieldId: string;
  rowIndex: number;
  columnIndex: number;
}

export const useGridSelection = (props: IUseGridSelectionProps) => {
  const { recordMap, columns, viewQuery, gridRef } = props;
  const [activeCell, setActiveCell] = useState<IActiveCell>();
  const [presortRecordData, setPresortRecordData] = useState<{
    rowIndex: number;
    recordId: string;
  }>();
  const prevActiveCellRef = useRef<IActiveCell | undefined>(activeCell);

  const fields = useFields();
  const presortRecord = useRecord(presortRecordData?.recordId);

  const viewId = useViewId() as string;
  const tableId = useTableId() as string;
  const { setSelection } = useGridViewStore();

  const { mutateAsync: mutateGetRecordStatus } = useMutation({
    mutationFn: async ({
      tableId,
      recordId,
      skip,
    }: {
      tableId: string;
      recordId: string;
      skip: number;
    }) => {
      const { collapsedGroupIds, ...rest } = viewQuery || {};

      if (collapsedGroupIds && collapsedGroupIds.length > LARGE_QUERY_THRESHOLD) {
        const { data } = await saveQueryParams({ params: { collapsedGroupIds } });
        return getRecordStatus(tableId, recordId, {
          ...rest,
          viewId,
          skip,
          take: 1,
          queryId: data.queryId,
        });
      }
      return getRecordStatus(tableId, recordId, { ...viewQuery, viewId, skip, take: 1 });
    },
    onSuccess: (data) => {
      if (activeCell == null) return setActiveCell(undefined);

      const { isDeleted, isVisible } = data.data;

      if (!isDeleted && !isVisible) {
        const { recordId, fieldId } = activeCell;
        const recordEntry = Object.entries(recordMap).find(
          ([_, record]) => record?.id === recordId
        );

        setPresortRecordData({ rowIndex: activeCell.rowIndex, recordId });

        if (!recordEntry) return gridRef.current?.setSelection(emptySelection);

        const rowIndex = parseInt(recordEntry[0]);
        const columnIndex = columns.findIndex((column) => column.id === fieldId);
        const range = [columnIndex, rowIndex] as IRange;

        if (gridRef.current?.isEditing() && isNeedPersistEditing(fields, fieldId)) {
          return gridRef.current?.setSelection(
            new CombinedSelection(SelectionRegionType.Cells, [range, range])
          );
        }
      }

      if (isDeleted) {
        setActiveCell(undefined);
        setSelection(emptySelection);
        gridRef.current?.setSelection(emptySelection);
      }
    },
  });

  const createCellValue2GridDisplay = useCreateCellValue2GridDisplay();

  const getPresortCellContent = useCallback<(cell: ICellItem) => ICell>(
    (cell) => {
      const [columnIndex] = cell;
      const cellValue2GridDisplay = createCellValue2GridDisplay(fields);
      if (presortRecord != null) {
        const fieldId = columns[columnIndex]?.id;
        if (!fieldId) return { type: CellType.Loading };
        return cellValue2GridDisplay(presortRecord, columnIndex, true);
      }
      return { type: CellType.Loading };
    },
    [columns, createCellValue2GridDisplay, fields, presortRecord]
  );

  const onPresortCellEdited = useCallback(
    (cell: ICellItem, newVal: IInnerCell) => {
      if (presortRecord == null) return;

      const [col] = cell;
      const fieldId = columns[col].id;
      const { type, data } = newVal;
      let newCellValue: unknown = null;

      switch (type) {
        case CellType.Select:
          newCellValue = data?.length ? data : null;
          break;
        case CellType.Text:
        case CellType.Number:
        case CellType.Boolean:
        default:
          newCellValue = data === '' ? null : data;
      }
      const oldCellValue = presortRecord.getCellValue(fieldId) ?? null;
      if (isEqual(newCellValue, oldCellValue)) return;
      presortRecord.updateCell(fieldId, newCellValue);
      return presortRecord;
    },
    [presortRecord, columns]
  );

  const onSelectionChanged = useCallback(
    (selection: CombinedSelection) => {
      const { type, ranges } = selection;
      let columnIndex: number | undefined;
      let rowIndex: number | undefined;

      setSelection(selection);

      if (type === SelectionRegionType.None) {
        setActiveCell(undefined);
        prevActiveCellRef.current = undefined;
        return;
      }
      if (type === SelectionRegionType.Cells) {
        columnIndex = ranges[0][0];
        rowIndex = ranges[0][1];
      }
      if (type === SelectionRegionType.Columns) {
        columnIndex = ranges[0][0];
        rowIndex = 0;
      }
      if (type === SelectionRegionType.Rows) return;
      if (columnIndex == null || rowIndex == null) return;

      const record = recordMap[rowIndex];
      const column = columns[columnIndex];

      if (!column || !record) return;

      const curActiveCell = {
        recordId: record.id,
        fieldId: column.id,
        rowIndex,
        columnIndex,
      };

      if (isEqual(activeCell, curActiveCell)) return;

      prevActiveCellRef.current = curActiveCell;
      setActiveCell(curActiveCell);
    },
    [activeCell, columns, recordMap, setSelection]
  );

  useEffect(() => {
    if (activeCell == null || prevActiveCellRef.current == null) return;

    const { rowIndex, columnIndex } = prevActiveCellRef.current;

    if (rowIndex !== activeCell.rowIndex || columnIndex !== activeCell.columnIndex) {
      return;
    }

    const activeRecordId = activeCell.recordId;

    if (recordMap[rowIndex]?.id === activeRecordId) return;

    mutateGetRecordStatus({
      tableId,
      recordId: activeCell.recordId,
      skip: activeCell.rowIndex,
    });
  }, [activeCell, gridRef, recordMap, tableId, mutateGetRecordStatus]);

  useEffect(() => {
    if (!gridRef.current?.isEditing()) return;

    const { columnIndex, rowIndex, fieldId } = activeCell ?? {};

    if (columnIndex == null || rowIndex == null || fieldId == null) return;

    const realColumnIndex = columns.findIndex((column) => column.id === fieldId);

    if (columnIndex === realColumnIndex) return;

    const range = [realColumnIndex, rowIndex] as IRange;
    gridRef.current?.setSelection(new CombinedSelection(SelectionRegionType.Cells, [range, range]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns]);

  return useMemo(
    () => ({
      activeCell,
      presortRecord,
      presortRecordData,
      onSelectionChanged,
      onPresortCellEdited,
      getPresortCellContent,
      setPresortRecordData,
    }),
    [
      activeCell,
      presortRecord,
      presortRecordData,
      onSelectionChanged,
      onPresortCellEdited,
      getPresortCellContent,
      setPresortRecordData,
    ]
  );
};
