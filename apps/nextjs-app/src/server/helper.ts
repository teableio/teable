import { ROW_ORDER_FIELD_PREFIX } from './constant';

export function getViewOrderFieldName(viewId: string) {
  return `${ROW_ORDER_FIELD_PREFIX}_${viewId}`;
}

export function convertNameToValidCharacter(name: string, maxLength = 10): string {
  const matchedArray = name.match(/\w*/g);
  return matchedArray?.join('').substring(0, maxLength) || 'unnamed';
}
