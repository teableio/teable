/* eslint-disable sonarjs/no-duplicate-string */
import { dateRange, is, isNot } from '@teable/core';
import dayjs from 'dayjs';
import { getDates } from './utils';

const tz = 'Asia/Singapore';
const now = dayjs().tz(tz);
const { dates, lookupDates } = getDates();

// Date range: from 2020-01-01 to 2020-01-15
const rangeStart = dayjs.tz('2020-01-01', tz);
const rangeEnd = dayjs.tz('2020-01-15', tz);

export const DATE_RANGE_SETS = [
  // Basic date range filter
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: dateRange.value,
      exactDate: rangeStart.toISOString(),
      exactDateEnd: rangeEnd.toISOString(),
      timeZone: tz,
    },
    expectResultLength: dates.filter(
      (t) =>
        (t.isAfter(rangeStart.startOf('day')) || t.isSame(rangeStart.startOf('day'))) &&
        (t.isBefore(rangeEnd.endOf('day')) || t.isSame(rangeEnd.endOf('day')))
    ).length,
  },
  // Date range: from yesterday to tomorrow
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: dateRange.value,
      exactDate: now.subtract(1, 'day').startOf('day').toISOString(),
      exactDateEnd: now.add(1, 'day').endOf('day').toISOString(),
      timeZone: tz,
    },
    expectResultLength: 3, // yesterday, today, tomorrow
  },
  // Date range: entire current month
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: dateRange.value,
      exactDate: now.startOf('month').toISOString(),
      exactDateEnd: now.endOf('month').toISOString(),
      timeZone: tz,
    },
    expectResultLength: dates.filter((t) => t.isSame(now, 'month')).length,
  },
  // Single day range (start == end)
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: dateRange.value,
      exactDate: rangeStart.toISOString(),
      exactDateEnd: rangeStart.endOf('day').toISOString(),
      timeZone: tz,
    },
    expectResultLength: dates.filter((t) => t.isSame(rangeStart, 'day')).length,
  },
];

export const LOOKUP_DATE_RANGE_SETS = [
  {
    fieldIndex: 6,
    operator: is.value,
    queryValue: {
      mode: dateRange.value,
      exactDate: rangeStart.toISOString(),
      exactDateEnd: rangeEnd.toISOString(),
      timeZone: tz,
    },
    expectResultLength: lookupDates.filter((dates) =>
      dates.some(
        (t) =>
          (t.isAfter(rangeStart.startOf('day')) || t.isSame(rangeStart.startOf('day'))) &&
          (t.isBefore(rangeEnd.endOf('day')) || t.isSame(rangeEnd.endOf('day')))
      )
    ).length,
  },
];

// Error cases for dateRange - these need special handling in tests
// eslint-disable-next-line @typescript-eslint/naming-convention
export const DATE_RANGE_ERROR_CASES = {
  // start > end should throw error
  invalidRange: {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: dateRange.value,
      exactDate: rangeEnd.toISOString(), // end date as start
      exactDateEnd: rangeStart.toISOString(), // start date as end - INVALID!
      timeZone: tz,
    },
  },
  // dateRange with isNot operator should throw error
  invalidOperator: {
    fieldIndex: 3,
    operator: isNot.value,
    queryValue: {
      mode: dateRange.value,
      exactDate: rangeStart.toISOString(),
      exactDateEnd: rangeEnd.toISOString(),
      timeZone: tz,
    },
  },
};
