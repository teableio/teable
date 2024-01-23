import { isEqual, keyBy } from 'lodash';
import { useCallback, useMemo, useState } from 'react';
import { useFields, useRecord, useTablePermission, useView } from '../../../hooks';
import type { GridView } from '../../../model';
import { getFilterFieldIds } from '../../filter/utils';
import { CellType } from '../../grid/interface';
import type { ICell, ICellItem, IGridColumn, IInnerCell } from '../../grid/interface';
import { createCellValue2GridDisplay } from './use-grid-columns';

export const useGridPrefillingRow = (columns: (IGridColumn & { id: string })[]) => {
  const view = useView() as GridView | undefined;
  const fields = useFields();
  const totalFields = useFields({ withHidden: true });
  const permission = useTablePermission();
  const sort = view?.sort;
  const isAutoSort = sort && !sort?.manualSort;
  const editable = permission['record|update'];
  const [prefillingRecordId, setPrefillingRecordId] = useState<string>();
  const [prefillingRowIndex, setPrefillingRowIndex] = useState<number>();
  const record = useRecord(prefillingRecordId);

  const getPrefillingCellContent = useCallback<(cell: ICellItem) => ICell>(
    (cell) => {
      const [columnIndex] = cell;
      const cellValue2GridDisplay = createCellValue2GridDisplay(fields, editable);
      if (record != null) {
        const fieldId = columns[columnIndex]?.id;
        if (!fieldId) return { type: CellType.Loading };
        return cellValue2GridDisplay(record, columnIndex);
      }
      return { type: CellType.Loading };
    },
    [columns, editable, fields, record]
  );

  const onPrefillingCellEdited = useCallback(
    (cell: ICellItem, newVal: IInnerCell) => {
      if (record == null) return;

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
      const oldCellValue = record.getCellValue(fieldId) ?? null;
      if (isEqual(newCellValue, oldCellValue)) return;
      record.updateCell(fieldId, newCellValue);
      return record;
    },
    [record, columns]
  );

  const isRowPrefillingActived = useMemo(() => {
    if (isAutoSort) return true;

    const filter = view?.filter;

    if (filter == null) return false;

    const filterIds = getFilterFieldIds(filter?.filterSet, keyBy(totalFields, 'id'));
    return Boolean(filterIds.size);
  }, [isAutoSort, totalFields, view?.filter]);

  return useMemo(() => {
    return {
      prefillingRowIndex,
      isRowPrefillingActived,
      setPrefillingRowIndex,
      setPrefillingRecordId,
      onPrefillingCellEdited,
      getPrefillingCellContent,
    };
  }, [
    prefillingRowIndex,
    isRowPrefillingActived,
    getPrefillingCellContent,
    onPrefillingCellEdited,
  ]);
};
