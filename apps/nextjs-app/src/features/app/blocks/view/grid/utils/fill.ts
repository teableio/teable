import { FieldType } from '@teable/core';

const isNumberValue = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const isParsableDate = (v: unknown) =>
  (typeof v === 'string' || typeof v === 'number' || v instanceof Date) &&
  !Number.isNaN(new Date(v as never).getTime());

const toSameDateType = (base: unknown, ts: number) => {
  if (typeof base === 'number') return ts;
  if (base instanceof Date) return new Date(ts);
  return new Date(ts).toISOString();
};

export const isEmptyValue = (v: unknown) =>
  v == null || (Array.isArray(v) && v.length === 0) || (typeof v === 'string' && v.trim() === '');

const shouldGenerateNumberSeries = (values: unknown[]) => {
  const nums = values.filter(isNumberValue) as number[];
  if (nums.length < 2) return false;
  if (values.some((v) => isEmptyValue(v))) return false;
  const first = nums[0];
  return nums.some((n) => n !== first);
};

const shouldGenerateDateSeries = (values: unknown[]) => {
  if (values.length !== 2) return false;
  const [v1, v2] = values;
  const d1 = isParsableDate(v1) ? new Date(v1 as never).getTime() : NaN;
  const d2 = isParsableDate(v2) ? new Date(v2 as never).getTime() : NaN;
  return Number.isFinite(d1) && Number.isFinite(d2) && d1 !== d2;
};

export const generateNumberSeries = (
  baseValues: unknown[],
  outLen: number,
  direction: 'down' | 'up'
): unknown[] | null => {
  const nums = baseValues.filter(isNumberValue) as number[];
  if (nums.length < 2) return null;
  const diffs: number[] = [];
  for (let i = 1; i < nums.length; i++) {
    diffs.push(nums[i] - nums[i - 1]);
  }
  if (!diffs.some((d) => d !== 0)) return null;

  if (direction === 'down') {
    const result: number[] = [];
    let current = nums[nums.length - 1];
    for (let i = 0; i < outLen; i++) {
      const d = diffs[i % diffs.length];
      current += d;
      result.push(current);
    }
    return result;
  }
  const resultUp: number[] = [];
  let currentUp = nums[0];
  for (let i = 0; i < outLen; i++) {
    const d = diffs[(diffs.length - 1 - (i % diffs.length) + diffs.length) % diffs.length];
    currentUp -= d;
    resultUp.push(currentUp);
  }
  return resultUp;
};

export const generateDateSeries = (
  baseValues: unknown[],
  outLen: number,
  direction: 'down' | 'up'
): unknown[] | null => {
  const dates = baseValues.filter(isParsableDate);
  if (dates.length >= 2) {
    const tsLast = new Date(dates[dates.length - 1] as never).getTime();
    const tsPrev = new Date(dates[dates.length - 2] as never).getTime();
    const stepMs = tsLast - tsPrev || 24 * 60 * 60 * 1000;
    const baseDateValue = dates[dates.length - 1];
    if (direction === 'down') {
      const startTs = tsLast + stepMs;
      return Array.from({ length: outLen }, (_, i) =>
        toSameDateType(baseDateValue, startTs + stepMs * i)
      );
    }
    const firstDateValue = dates[0];
    const firstTs = new Date(firstDateValue as never).getTime();
    const startTs = firstTs - stepMs;
    return Array.from({ length: outLen }, (_, i) =>
      toSameDateType(firstDateValue, startTs - stepMs * i)
    );
  }
  return null;
};

export const generateSeriesForColumn = (
  baseColumnValues: unknown[],
  fieldType: FieldType,
  outLen: number,
  direction: 'down' | 'up'
): unknown[] => {
  if (fieldType === FieldType.Number && shouldGenerateNumberSeries(baseColumnValues)) {
    const numberSeries = generateNumberSeries(baseColumnValues, outLen, direction);
    if (numberSeries) return numberSeries;
  } else if (fieldType === FieldType.Date && shouldGenerateDateSeries(baseColumnValues)) {
    const dateSeries = generateDateSeries(baseColumnValues, outLen, direction);
    if (dateSeries) return dateSeries;
  }
  if (direction === 'down') {
    return Array.from({ length: outLen }, (_, i) => baseColumnValues[i % baseColumnValues.length]);
  }
  return Array.from({ length: outLen }, (_, i) => {
    const len = baseColumnValues.length;
    const idx = (len - 1 - ((outLen - 1 - i) % len) + len) % len;
    return baseColumnValues[idx];
  });
};
