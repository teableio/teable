import { useContext, useMemo } from 'react';
import { FieldContext } from '../context';
import { useViewId } from './use-view-id';

export function useFields(options: { entireColumn?: boolean } = {}) {
  const { entireColumn } = options;
  const { fields } = useContext(FieldContext);
  const viewId = useViewId();

  return useMemo(() => {
    return entireColumn
      ? fields
      : fields.filter(({ columnMeta }) => viewId && !columnMeta?.[viewId]?.hidden);
  }, [viewId, fields, entireColumn]);
}
