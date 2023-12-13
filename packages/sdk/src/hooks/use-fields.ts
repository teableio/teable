import { sortBy } from 'lodash';
import { useContext, useMemo } from 'react';
import { FieldContext } from '../context';
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
    return withHidden || !view ? fields : fields.filter(({ id }) => !view.columnMeta?.[id]?.hidden);
  }, [view, fields, withHidden]);
}
