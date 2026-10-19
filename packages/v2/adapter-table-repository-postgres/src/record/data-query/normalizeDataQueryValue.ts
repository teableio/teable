import type { TableRecordAggregationFunction } from '@teable/v2-core';

const unsafeIntegerLimit = BigInt(Number.MAX_SAFE_INTEGER);

/** Normalize driver representations without silently rounding PostgreSQL int8 values. */
export const normalizeDataQueryValue = (
  value: unknown,
  statisticFunc?: TableRecordAggregationFunction
): unknown => {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') {
    return value <= unsafeIntegerLimit && value >= -unsafeIntegerLimit
      ? Number(value)
      : value.toString();
  }
  if (
    statisticFunc &&
    statisticFunc !== 'earliestDate' &&
    statisticFunc !== 'latestDate' &&
    typeof value === 'string'
  ) {
    if (/^-?\d+$/.test(value)) {
      const integer = BigInt(value);
      return integer <= unsafeIntegerLimit && integer >= -unsafeIntegerLimit
        ? Number(integer)
        : value;
    }
    const number = Number(value);
    if (value.trim() !== '' && Number.isFinite(number)) {
      if (Number.isInteger(number) && !Number.isSafeInteger(number)) return value;
      return number;
    }
  }
  if (Array.isArray(value)) return value.map((item) => normalizeDataQueryValue(item));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeDataQueryValue(item)])
    );
  }
  return value;
};
