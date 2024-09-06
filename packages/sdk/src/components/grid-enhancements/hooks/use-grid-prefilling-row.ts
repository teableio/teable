import type { IUpdateOrderRo } from '@teable/openapi';
import { isEqual } from 'lodash';
import { useCallback, useMemo, useState } from 'react';
import { useFieldCellEditable, useFields } from '../../../hooks';
import { createRecordInstance } from '../../../model';
import { CellType } from '../../grid/interface';
import type { ICell, ICellItem, IGridColumn, IInnerCell } from '../../grid/interface';
import { useCreateCellValue2GridDisplay } from './use-grid-columns';

export const useGridPrefillingRow = (columns: (IGridColumn & { id: string })[]) => {
  const fields = useFields();
  const fieldEditable = useFieldCellEditable();

  const [prefillingRowOrder, setPrefillingRowOrder] = useState<IUpdateOrderRo>();
  const [prefillingRowIndex, setPrefillingRowIndex] = useState<number>();
  const [prefillingFieldValueMap, setPrefillingFieldValueMap] = useState<
    { [fieldId: string]: unknown } | undefined
  >();

  const localRecord = useMemo(() => {
    if (prefillingFieldValueMap == null) {
      return null;
    }

    const record = createRecordInstance({
      id: '',
      fields: prefillingFieldValueMap,
    });
    record.getCellValue = (fieldId: string) => {
      return prefillingFieldValueMap[fieldId];
    };
    record.updateCell = (fieldId: string, newValue: unknown) => {
      record.fields[fieldId] = newValue;
      setPrefillingFieldValueMap({
        ...prefillingFieldValueMap,
        [fieldId]: newValue,
      });
      return Promise.resolve();
    };

    return record;
  }, [prefillingFieldValueMap]);
  const createCellValue2GridDisplay = useCreateCellValue2GridDisplay();
  const getPrefillingCellContent = useCallback<(cell: ICellItem) => ICell>(
    (cell) => {
      const [columnIndex] = cell;
      const cellValue2GridDisplay = createCellValue2GridDisplay(fields, fieldEditable);
      if (localRecord != null) {
        const fieldId = columns[columnIndex]?.id;
        if (!fieldId) return { type: CellType.Loading };
        return cellValue2GridDisplay(localRecord, columnIndex, true);
      }
      return { type: CellType.Loading };
    },
    [columns, createCellValue2GridDisplay, fieldEditable, fields, localRecord]
  );

  const onPrefillingCellEdited = useCallback(
    (cell: ICellItem, newVal: IInnerCell) => {
      if (localRecord == null) return;

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
      const oldCellValue = localRecord.getCellValue(fieldId) ?? null;
      if (isEqual(newCellValue, oldCellValue)) return;
      localRecord.updateCell(fieldId, newCellValue);
      return localRecord;
    },
    [localRecord, columns]
  );

  return useMemo(() => {
    return {
      localRecord,
      prefillingRowIndex,
      prefillingRowOrder,
      prefillingFieldValueMap,
      setPrefillingRowIndex,
      setPrefillingRowOrder,
      onPrefillingCellEdited,
      getPrefillingCellContent,
      setPrefillingFieldValueMap,
    };
  }, [
    localRecord,
    prefillingRowIndex,
    prefillingRowOrder,
    prefillingFieldValueMap,
    setPrefillingRowIndex,
    setPrefillingRowOrder,
    onPrefillingCellEdited,
    getPrefillingCellContent,
    setPrefillingFieldValueMap,
  ]);
};
