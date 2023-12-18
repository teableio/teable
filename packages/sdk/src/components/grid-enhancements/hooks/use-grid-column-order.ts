import { useCallback } from 'react';
import { useTableId } from '../../../hooks';
import { useFields } from '../../../hooks/use-fields';
import { useView } from '../../../hooks/use-view';
import type { IFieldInstance } from '../../../model';
import { View } from '../../../model';
import { reorder } from '../../../utils';

export function useGridColumnOrder() {
  const fields = useFields();
  const tableId = useTableId();
  const view = useView();

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

      if (!view || !tableId) {
        throw new Error('Can not find view or tableId');
      }

      const newOrders = reorder(colIndexCollection.length, newColIndex, fields.length, (index) => {
        const fieldId = fields[index]?.id;
        return view?.columnMeta[fieldId].order;
      });

      View.setViewColumnMeta(
        tableId,
        view.id,
        operationFields.map((field, index) => ({
          fieldId: field.id,
          columnMeta: { order: newOrders[index] },
        }))
      );
    },
    [fields, tableId, view]
  );

  return { onColumnOrdered };
}
