import { useContext, useMemo } from 'react';
import { FieldContext } from '../context';
import { useViewId } from './use-view-id';

export function useFields(options: { widthHidden?: boolean } = {}) {
  const { widthHidden } = options;
  const { fields } = useContext(FieldContext);
  const viewId = useViewId();

  return useMemo(() => {
    return widthHidden || !viewId
      ? fields
      : fields.filter(({ columnMeta }) => !columnMeta?.[viewId]?.hidden);
  }, [viewId, fields, widthHidden]);
}
