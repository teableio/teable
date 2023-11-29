import { ROW_ORDER_FIELD_PREFIX } from '../features/view/constant';

export function getViewOrderFieldName(viewId?: string) {
  return viewId ? `${ROW_ORDER_FIELD_PREFIX}_${viewId}` : '__auto_number';
}
