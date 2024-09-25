import { isDate } from 'lodash';

export const convertValueToStringify = (value: unknown): number | string | null => {
  if (typeof value === 'bigint' || typeof value === 'number') {
    return Number(value);
  }
  if (isDate(value)) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  if (value == null) return null;
  return JSON.stringify(value);
};
