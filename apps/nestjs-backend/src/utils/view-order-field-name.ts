import { ROW_ORDER_FIELD_PREFIX } from '../features/view/constant';

export function getViewOrderFieldName(viewId: string) {
  return `${ROW_ORDER_FIELD_PREFIX}_${viewId}`;
}
