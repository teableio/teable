import { ViewType } from '@teable/core';
import { sortBy } from 'lodash';
import { useContext, useMemo } from 'react';
import { FieldContext } from '../context';
import { useView } from './use-view';

export function useFields(options: { withHidden?: boolean } = {}) {
  const { withHidden } = options;
  const { fields: originFields } = useContext(FieldContext);
  const view = useView();
  const { type: viewType, columnMeta } = view ?? {};

  return useMemo(() => {
    const sortedFields = sortBy(originFields, (field) => columnMeta?.[field.id]?.order ?? Infinity);

    if (withHidden || viewType == null) {
      return sortedFields;
    }
    if (viewType === ViewType.Form) {
      return sortedFields.filter(({ id }) => columnMeta?.[id]?.visible);
    }
    if (viewType === ViewType.Kanban) {
      return sortedFields.filter(({ id, isPrimary }) => {
        return isPrimary || columnMeta?.[id]?.visible;
      });
    }

    return sortedFields.filter(({ id }) => !columnMeta?.[id]?.hidden);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originFields, withHidden, viewType, JSON.stringify(columnMeta)]);
}
