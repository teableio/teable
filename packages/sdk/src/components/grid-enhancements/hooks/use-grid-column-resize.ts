import { useCallback, useState, useEffect } from 'react';
import { useDebounce } from 'react-use';
import type { IGridColumn } from '../..';
import { useView } from '../../../hooks';
import { useFields } from '../../../hooks/use-fields';
import { useViewId } from '../../../hooks/use-view-id';

export function useGridColumnResize<T extends { id: string }>(_columns: T[]) {
  const fields = useFields();
  const view = useView();
  const viewId = useViewId();
  const [newSize, setNewSize] = useState<number>();
  const [fieldId, setFieldId] = useState<string>();
  const [columns, setColumns] = useState(_columns);

  useEffect(() => setColumns(_columns), [_columns]);

  useDebounce(
    () => {
      if (!view || fieldId == null || newSize == null) {
        return;
      }
      if (!fields.some((field) => field.id === fieldId)) {
        return;
      }
      view.updateColumnMeta([
        {
          fieldId,
          columnMeta: { width: newSize },
        },
      ]);
    },
    300,
    [fieldId, newSize]
  );

  const onColumnResize = useCallback(
    (column: IGridColumn, newSize: number, _colIndex: number) => {
      const columnId = column.id;
      if (!columnId || !viewId) {
        return;
      }

      const field = fields.find((item) => item.id === columnId);
      if (!field) {
        return;
      }

      const index = columns.findIndex((ci) => ci.id === columnId);
      if (index < 0) {
        return;
      }

      const newColumns = [...columns];
      newColumns.splice(index, 1, {
        ...columns[index],
        width: newSize,
      });

      setColumns(newColumns);
      setNewSize(newSize);
      setFieldId(columnId);
    },
    [columns, fields, viewId]
  );

  return { columns, onColumnResize };
}
