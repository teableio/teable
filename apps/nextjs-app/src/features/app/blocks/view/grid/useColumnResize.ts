import type { GridColumn } from '@glideapps/glide-data-grid';
import { useFields, useViewId } from '@teable-group/sdk/hooks';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useState } from 'react';
import { useDebounce } from 'react-use';

export function useColumnResize<T extends { id: string }>(
  columns: T[],
  setColumns: Dispatch<SetStateAction<T[]>>
) {
  const { fields } = useFields();
  const viewId = useViewId();
  const [newSize, setNewSize] = useState<number>();
  const [index, setIndex] = useState<number>();

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

  return useCallback(
    (column: GridColumn, newSize: number, colIndex: number, _newSizeWithGrow: number) => {
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
}
