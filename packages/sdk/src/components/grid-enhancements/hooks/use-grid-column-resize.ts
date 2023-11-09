import { useCallback, useState, useEffect } from 'react';
import { useDebounce } from 'react-use';
import type { IGridColumn } from '../..';
import { useFields } from '../../../hooks/use-fields';
import { useViewId } from '../../../hooks/use-view-id';

export function useGridColumnResize<T extends { id: string }>(_columns: T[]) {
  const fields = useFields();
  const viewId = useViewId();
  const [newSize, setNewSize] = useState<number>();
  const [index, setIndex] = useState<number>();
  const [columns, setColumns] = useState(_columns);

  useEffect(() => setColumns(_columns), [_columns]);

  useDebounce(
    () => {
      if (!viewId) {
        throw new Error("Can't find view id");
      }
      if (index == null || newSize == null) {
        return;
      }
      fields[index].updateColumnWidth(viewId, newSize);
    },
    200,
    [index, newSize]
  );

  const onColumnResize = useCallback(
    (column: IGridColumn, newSize: number, colIndex: number) => {
      const fieldId = column.id;
      const field = fields[colIndex];
      if (!field) {
        throw new Error('Can not find field by id: ' + fieldId);
      }

      if (field.id !== column.id) {
        throw new Error('field id not match column id');
      }

      if (!viewId) {
        throw new Error('Can not find view id');
      }

      const index = columns.findIndex((ci) => ci.id === column.id);
      const newColumns = [...columns];
      const newColumn = {
        ...columns[index],
        width: newSize,
      };
      newColumns.splice(index, 1, newColumn);

      setColumns(newColumns);
      setNewSize(newSize);
      setIndex(colIndex);
    },
    [columns, fields, setColumns, viewId]
  );

  return { columns, onColumnResize };
}
