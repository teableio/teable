import { ViewType } from '@teable/core';
import { sortBy } from 'lodash';
import { useContext, useMemo } from 'react';
import { FieldContext } from '../context';
import type { FormView, GridView, KanbanView } from '../model';
import { useView } from './use-view';

export function useFields(options: { withHidden?: boolean } = {}) {
  const { withHidden } = options;
  const { fields: fieldsOrigin } = useContext(FieldContext);
  const view = useView();

  const fields = useMemo(
    () => sortBy(fieldsOrigin, (field) => view?.columnMeta[field.id]?.order ?? Infinity),
    [fieldsOrigin, view?.columnMeta]
  );

  return useMemo(() => {
    if (withHidden || !view) {
      return fields;
    }

    if (view.type === ViewType.Form) {
      return fields.filter(({ id }) => (view as FormView).columnMeta?.[id]?.visible);
    }
    if (view.type === ViewType.Kanban) {
      return fields.filter(({ id, isPrimary }) => {
        return isPrimary || (view as KanbanView).columnMeta?.[id]?.visible;
      });
    }
    return fields.filter(({ id }) => !(view as GridView).columnMeta?.[id]?.hidden);
  }, [view, fields, withHidden]);
}
