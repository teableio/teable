import { useContext, useMemo } from 'react';
import { FieldContext } from '../context';
import { useViewId } from './use-view-id';

export function useFields(entireColumn?: boolean) {
  const { fields } = useContext(FieldContext);
  const viewId = useViewId();

  if (!viewId) {
    throw new Error("Can't find view id");
  }

  return useMemo(() => {
    return entireColumn ? fields : fields.filter((field) => !field.columnMeta[viewId].hidden);
  }, [entireColumn, fields]);
}
