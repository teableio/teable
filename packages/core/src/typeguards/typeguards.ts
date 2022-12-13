export type IIsoDateString = string;
export const isIsoDateString = (dateStr: unknown): dateStr is IIsoDateString => {
  if (typeof dateStr !== 'string' || !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/.test(dateStr)) {
    return false;
  }
  try {
    const d = new Date(dateStr);
    return d.toISOString() === dateStr;
  } catch (e: unknown) {
    return false;
  }
};

export const isNonEmptyString = (v: unknown, trim = true): v is string => {
  return typeof v === 'string' && (trim ? v.trim() : v).length > 0;
};

export const isPlainObject = <T = unknown, K extends string | number = string>(
  v: unknown
): v is Record<K, T> => {
  return (
    typeof v === 'object' &&
    v !== null &&
    v.constructor === Object &&
    Object.getPrototypeOf(v) === Object.prototype
  );
};

export const isSafeInteger = (v: unknown): v is number => {
  return typeof v === 'number' && Number.isSafeInteger(v);
};

export const isParsableNumeric = (v: unknown): v is number | string => {
  if (typeof v === 'number' && !Number.isNaN(v)) {
    return true;
  }
  if (!isNonEmptyString(v)) {
    return false;
  }
  return !Number.isNaN(Number.parseInt(v, 10) || Number.isNaN(Number.parseFloat(v)));
};

export const isParsableSafeInteger = (v: unknown): v is number | string => {
  const value = typeof v === 'string' && /^-?\d+$/.test(v) ? Number.parseInt(v, 10) : v;
  return isSafeInteger(value);
};

export const isHttpStatusCode = (v: unknown): v is number => {
  return isSafeInteger(v) && v < 600 && v >= 100;
};

/**
 * Check whether a variable is not null and not undefined
 */
export function isPresent<T>(v: T): v is NonNullable<T> {
  return v !== undefined && v !== null;
}
