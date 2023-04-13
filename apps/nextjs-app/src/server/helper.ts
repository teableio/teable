import { ROW_ORDER_FIELD_PREFIX } from './constant';

export function getViewOrderFieldName(viewId: string) {
  return `${ROW_ORDER_FIELD_PREFIX}_${viewId}`;
}
