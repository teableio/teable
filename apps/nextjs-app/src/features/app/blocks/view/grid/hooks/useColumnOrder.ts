import { useFields, useViewId } from '@teable-group/sdk/hooks';
import { useCallback } from 'react';
import type { IGridColumn } from '../../../grid';

export function useColumnOrder() {
  const fields = useFields();
  const viewId = useViewId();

  const onColumnOrdered = useCallback(
    (column: IGridColumn, columnIndex: number, newColumnIndex: number) => {
      const columnId = column.id;
      const field = fields[columnIndex];
      const targetField = fields[newColumnIndex];

      if (!field) {
        throw new Error('Can not find field by id: ' + columnId);
      }

      if (!targetField) {
        throw new Error('Can not find target field by index: ' + newColumnIndex);
      }

      if (field.id !== columnId) {
        throw new Error('field id not match column id');
      }

      if (!viewId) {
        throw new Error('Can not find view id');
      }

      let newOrder = 0;
      if (newColumnIndex === 0) {
        newOrder = fields[0].columnMeta[viewId].order - 1;
      } else if (newColumnIndex > fields.length - 1) {
        newOrder = fields[fields.length - 1].columnMeta[viewId].order + 1;
      } else {
        const prevOrder = fields[newColumnIndex - 1].columnMeta[viewId].order;
        const nextOrder = fields[newColumnIndex].columnMeta[viewId].order;
        newOrder = (prevOrder + nextOrder) / 2;
      }

      field.updateColumnOrder(viewId, newOrder);
    },
    [fields, viewId]
  );

  return { onColumnOrdered };
}
