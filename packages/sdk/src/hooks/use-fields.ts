import { useContext, useMemo } from 'react';
import { FieldContext } from '../context';
import { useViewId } from './use-view-id';

export function useFields(options: { withHidden?: boolean } = {}) {
  const { withHidden } = options;
  const { fields } = useContext(FieldContext);
  const viewId = useViewId();

  return useMemo(() => {
    return withHidden || !viewId
      ? fields
      : fields.filter(({ columnMeta }) => !columnMeta?.[viewId]?.hidden);
  }, [viewId, fields, withHidden]);
}
