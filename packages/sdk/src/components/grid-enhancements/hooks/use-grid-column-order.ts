import { useCallback } from 'react';
import { useFields } from '../../../hooks/use-fields';
import { useViewId } from '../../../hooks/use-view-id';
import type { IFieldInstance } from '../../../model';
import { reorder } from '../../../utils';

export function useGridColumnOrder() {
  const fields = useFields();
  const viewId = useViewId();

  const onColumnOrdered = useCallback(
    (colIndexCollection: number[], newColIndex: number) => {
      const operationFields: IFieldInstance[] = [];

      for (const colIndex of colIndexCollection) {
        const field = fields[colIndex];
        if (!field) {
          throw new Error('Can not find field by index: ' + colIndex);
        }
        operationFields.push(field);
      }

      if (!viewId) {
        throw new Error('Can not find view id');
      }

      const newOrders = reorder(colIndexCollection.length, newColIndex, fields.length, (index) => {
        return fields[index].columnMeta[viewId].order;
      });

      operationFields.forEach((field, index) => {
        field.updateColumnOrder(viewId, newOrders[index]);
      });
    },
    [fields, viewId]
  );

  return { onColumnOrdered };
}
