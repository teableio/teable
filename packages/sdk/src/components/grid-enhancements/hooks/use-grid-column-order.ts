import { useCallback, useEffect } from 'react';
import { useViewColumnOrderStore } from '../../../context/view/store/useViewColumnOrderStore';
import { useFields } from '../../../hooks/use-fields';
import { useView } from '../../../hooks/use-view';
import type { IFieldInstance } from '../../../model';
import { reorder } from '../../../utils';

export function useGridColumnOrder() {
  const fields = useFields();
  const view = useView();
  const setPendingOrder = useViewColumnOrderStore((state) => state.setPendingOrder);
  const prunePendingOrder = useViewColumnOrderStore((state) => state.prunePendingOrder);
  const clearPendingOrder = useViewColumnOrderStore((state) => state.clearPendingOrder);

  const viewId = view?.id;
  const columnMeta = view?.columnMeta;

  // the optimistic overlay is only meaningful while this grid is on screen:
  // leaving the view (or table) tears down the doc subscription that would
  // confirm it, so a stale entry could shadow later collaborator reorders —
  // hand back to server data on unmount / view switch
  useEffect(() => {
    if (!viewId) return;
    return () => {
      useViewColumnOrderStore.getState().clearPendingOrder(viewId);
    };
  }, [viewId]);

  // once the server-confirmed columnMeta reflects a pending order (or the
  // field is gone), drop the optimistic entry so later remote reorders from
  // collaborators are no longer shadowed
  useEffect(() => {
    if (!viewId || !columnMeta) return;
    const pending = useViewColumnOrderStore.getState().pendingOrderMap[viewId];
    if (!pending) return;
    const confirmedFieldIds = Object.keys(pending).filter(
      (fieldId) => !(fieldId in columnMeta) || columnMeta[fieldId].order === pending[fieldId]
    );
    if (confirmedFieldIds.length) {
      prunePendingOrder(viewId, confirmedFieldIds);
    }
  }, [viewId, columnMeta, prunePendingOrder]);

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

      if (!view) {
        throw new Error('Can not find view');
      }

      // fields are sorted by the effective (pending-first) order, so neighbor
      // orders must be read the same way or a second drag while a request is
      // in flight would compute against stale positions
      const pending = useViewColumnOrderStore.getState().pendingOrderMap[view.id];
      const newOrders = reorder(colIndexCollection.length, newColIndex, fields.length, (index) => {
        const fieldId = fields[index]?.id;
        return pending?.[fieldId] ?? view?.columnMeta[fieldId]?.order;
      });

      // neighbor meta can be momentarily absent (e.g. a just-created field);
      // bail out entirely rather than propagating NaN orders
      if (!newOrders.every(Number.isFinite)) {
        return;
      }

      const columnMetaRo = operationFields.map((field, index) => ({
        fieldId: field.id,
        columnMeta: { order: newOrders[index] },
      }));

      setPendingOrder(
        view.id,
        Object.fromEntries(
          columnMetaRo.map(({ fieldId, columnMeta }) => [fieldId, columnMeta.order])
        )
      );

      // Promise.resolve().then guards against proxied (sync) updateColumnMeta
      // implementations throwing synchronously — every failure path must end
      // in a rollback, never an uncaught error
      Promise.resolve()
        .then(() => view.updateColumnMeta(columnMetaRo))
        .catch(() => {
          // requestWrap already surfaced the error toast; roll back to the
          // last server-confirmed order
          clearPendingOrder(view.id);
        });
    },
    [fields, view, setPendingOrder, clearPendingOrder]
  );

  return { onColumnOrdered };
}
