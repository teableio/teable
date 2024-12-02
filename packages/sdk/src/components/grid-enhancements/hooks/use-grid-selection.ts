import { useMutation } from '@tanstack/react-query';
import type { IGetRecordsRo } from '@teable/openapi';
import { getRecordStatus } from '@teable/openapi';
import { isEqual } from 'lodash';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFieldCellEditable, useFields, useRecord, useTableId, useViewId } from '../../../hooks';
import type { Record as IRecord } from '../../../model';
import type { IGridRef } from '../../grid/Grid';
import type { ICell, ICellItem, IGridColumn, IInnerCell } from '../../grid/interface';
import { CellType, SelectionRegionType } from '../../grid/interface';
import { emptySelection, type CombinedSelection } from '../../grid/managers';
import { useGridViewStore } from '../store/useGridViewStore';
import { useCreateCellValue2GridDisplay } from './use-grid-columns';

interface IUseGridSelectionProps {
  recordMap: Record<string, IRecord>;
  columns: (IGridColumn & {
    id: string;
  })[];
  viewQuery?: Pick<IGetRecordsRo, 'filter' | 'orderBy' | 'groupBy' | 'collapsedGroupIds'>;
  gridRef: React.RefObject<IGridRef>;
}

interface IActiveCell {
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
  const fieldEditable = useFieldCellEditable();
  const presortRecord = useRecord(presortRecordData?.recordId);

  const viewId = useViewId() as string;
  const tableId = useTableId() as string;
  const { setSelection } = useGridViewStore();

  const { mutateAsync: mutateGetRecordStatus } = useMutation({
    mutationFn: ({
      tableId,
      recordId,
      skip,
    }: {
      tableId: string;
      recordId: string;
      skip: number;
    }) => getRecordStatus(tableId, recordId, { ...viewQuery, viewId, skip, take: 1 }),
    onSuccess: (data) => {
      if (activeCell == null) return setActiveCell(undefined);

      const { isDeleted, isVisible } = data.data;

      if (!isDeleted && !isVisible) {
        setPresortRecordData({
          rowIndex: activeCell.rowIndex,
          recordId: activeCell.recordId,
        });
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
      const cellValue2GridDisplay = createCellValue2GridDisplay(fields, fieldEditable);
      if (presortRecord != null) {
        const fieldId = columns[columnIndex]?.id;
        if (!fieldId) return { type: CellType.Loading };
        return cellValue2GridDisplay(presortRecord, columnIndex, true);
      }
      return { type: CellType.Loading };
    },
    [columns, createCellValue2GridDisplay, fieldEditable, fields, presortRecord]
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

  return useMemo(
    () => ({
      presortRecord,
      presortRecordData,
      onSelectionChanged,
      onPresortCellEdited,
      getPresortCellContent,
      setPresortRecordData,
    }),
    [
      presortRecord,
      presortRecordData,
      onSelectionChanged,
      onPresortCellEdited,
      getPresortCellContent,
      setPresortRecordData,
    ]
  );
};
