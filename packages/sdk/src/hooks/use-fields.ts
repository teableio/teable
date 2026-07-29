import { ViewType } from '@teable/core';
import { sortBy } from 'lodash';
import { useContext, useMemo } from 'react';
import { FieldContext } from '../context';
import { useViewColumnOrderStore } from '../context/view/store/useViewColumnOrderStore';
import { useView } from './use-view';

export function useFields(options: { withHidden?: boolean; withDenied?: boolean } = {}) {
  const { withHidden, withDenied } = options;
  const { fields: originFields } = useContext(FieldContext);

  const view = useView();
  const { id: viewId, type: viewType, columnMeta } = view ?? {};
  // optimistic column order applied while a reorder request is in flight
  const pendingOrder = useViewColumnOrderStore((state) =>
    viewId ? state.pendingOrderMap[viewId] : undefined
  );

  return useMemo(() => {
    const sortedFields = sortBy(
      originFields,
      (field) => pendingOrder?.[field.id] ?? columnMeta?.[field.id]?.order ?? Infinity
    );

    if ((withHidden && withDenied) || viewType == null) {
      return sortedFields;
    }

    return sortedFields.filter(({ id, canReadFieldRecord }) => {
      const isHidden = () => {
        if (withHidden) {
          return true;
        }
        // make sure these view rich display as default
        if (
          viewType === ViewType.Kanban ||
          viewType === ViewType.Gallery ||
          viewType === ViewType.Calendar
        ) {
          return columnMeta?.[id]?.visible === undefined ? true : columnMeta?.[id]?.visible;
        }
        if (viewType === ViewType.Form) {
          return columnMeta?.[id]?.visible;
        }
        return !columnMeta?.[id]?.hidden;
      };
      const hasPermission = () => {
        if (withDenied) {
          return true;
        }
        return canReadFieldRecord;
      };
      return isHidden() && hasPermission();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originFields, withHidden, viewType, pendingOrder, JSON.stringify(columnMeta)]);
}
