import type { IUpdateOrderRo } from '@teable/openapi';
import { isEqual, keyBy } from 'lodash';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBaseId, useFields, useSession, useTableId, useView } from '../../../hooks';
import { createRecordInstance } from '../../../model';
import { extractDefaultFieldsFromFilters } from '../../../utils';
import { CellType } from '../../grid/interface';
import type { ICell, ICellItem, IGridColumn, IInnerCell } from '../../grid/interface';
import { useCreateCellValue2GridDisplay } from './use-grid-columns';

export const useGridPrefillingRow = (columns: (IGridColumn & { id: string })[]) => {
  const view = useView();
  const baseId = useBaseId();
  const tableId = useTableId();
  const fields = useFields();
  const allFields = useFields({ withHidden: true });
  const { user } = useSession();
  const filter = view?.filter;
  const userId = user.id;

  const [prefillingRowOrder, setPrefillingRowOrder] = useState<IUpdateOrderRo>();
  const [prefillingRowIndex, setPrefillingRowIndex] = useState<number>();
  const [prefillingRows, setPrefillingRows] = useState<
    { fields: { [fieldId: string]: unknown } }[]
  >([]);

  const localRecords = useMemo(() => {
    return prefillingRows.map((row, index) => {
      const record = createRecordInstance({
        id: '',
        fields: row.fields as never,
      });
      record.getCellValue = (fieldId: string) => {
        return prefillingRows[index]?.fields?.[fieldId];
      };
      record.updateCell = (fieldId: string, newValue: unknown) => {
        setPrefillingRows((prev) => {
          const next = [...prev];
          const current = next[index] ?? { fields: {} };
          next[index] = { fields: { ...current.fields, [fieldId]: newValue } };
          return next;
        });
        return Promise.resolve();
      };
      return record;
    });
  }, [prefillingRows, setPrefillingRows]);

  const createCellValue2GridDisplay = useCreateCellValue2GridDisplay();
  const getPrefillingCellContent = useCallback<(cell: ICellItem) => ICell>(
    (cell) => {
      const [columnIndex, rowIndex] = cell;
      const cellValue2GridDisplay = createCellValue2GridDisplay(fields);
      const record = localRecords[rowIndex ?? 0];
      if (!record) return { type: CellType.Loading };
      if (columns[columnIndex]?.id == null) return { type: CellType.Loading };
      return cellValue2GridDisplay(record, columnIndex, true);
    },
    [columns, createCellValue2GridDisplay, fields, localRecords]
  );

  useEffect(() => {
    if (prefillingRowIndex == null) return;
    const updateDefaultValue = async () => {
      const fieldValue = await extractDefaultFieldsFromFilters({
        filter,
        fieldMap: keyBy(allFields, 'id'),
        currentUserId: userId,
        baseId,
        tableId,
        isAsync: true,
      });
      setPrefillingRows((prev) => {
        const next = prev.length ? [...prev] : [{ fields: {} }];
        const first = next[0] ?? { fields: {} };
        next[0] = { fields: { ...first.fields, ...fieldValue } };
        return next;
      });
    };
    updateDefaultValue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillingRowIndex]);

  const onPrefillingCellEdited = useCallback(
    (cell: ICellItem, newVal: IInnerCell) => {
      const [col, rowIndex = 0] = cell;
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
      const record = localRecords[rowIndex];
      const oldCellValue = record?.getCellValue(fieldId) ?? null;
      if (isEqual(newCellValue, oldCellValue)) return;
      if (record?.updateCell) {
        record.updateCell(fieldId, newCellValue);
      } else {
        setPrefillingRows((prev) => {
          const next = prev.length ? [...prev] : [{ fields: {} }];
          const row = next[rowIndex] ?? { fields: {} };
          next[rowIndex] = { fields: { ...row.fields, [fieldId]: newCellValue } };
          return next;
        });
      }
    },
    [columns, localRecords, setPrefillingRows]
  );

  return {
    prefillingRows,
    prefillingRowIndex,
    prefillingRowOrder,
    localRecords,
    setPrefillingRows,
    setPrefillingRowIndex,
    setPrefillingRowOrder,
    onPrefillingCellEdited,
    getPrefillingCellContent,
  };
};
