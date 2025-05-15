/* eslint-disable sonarjs/no-duplicate-string */
import {
  currentMonth,
  currentWeek,
  currentYear,
  daysAgo,
  daysFromNow,
  exactDate,
  exactFormatDate,
  isNot,
  lastMonth,
  lastWeek,
  lastYear,
  nextMonthPeriod,
  nextWeekPeriod,
  nextYearPeriod,
  oneMonthAgo,
  oneMonthFromNow,
  oneWeekAgo,
  oneWeekFromNow,
  today,
  tomorrow,
  yesterday,
} from '@teable/core';
import dayjs from 'dayjs';
import { getDates } from './utils';

const tz = 'Asia/Singapore';
const now = dayjs().tz(tz);
const { dates, lookupDates } = getDates();

export const IS_NOT_SETS = [
  {
    fieldIndex: 3,
    operator: isNot.value,
    queryValue: {
      mode: today.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 22,
  },
  {
    fieldIndex: 3,
    operator: isNot.value,
    queryValue: {
      mode: tomorrow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 22,
  },
  {
    fieldIndex: 3,
    operator: isNot.value,
    queryValue: {
      mode: yesterday.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 22,
  },
  {
    fieldIndex: 3,
    operator: isNot.value,
    queryValue: {
      mode: currentWeek.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 23 - dates.filter((t) => t.isSame(now, 'week')).length,
  },
  {
    fieldIndex: 3,
    operator: isNot.value,
    queryValue: {
      mode: nextWeekPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 23 - dates.filter((t) => t.isSame(now.add(1, 'week'), 'week')).length,
  },
  {
    fieldIndex: 3,
    operator: isNot.value,
    queryValue: {
      mode: lastWeek.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 23 - dates.filter((t) => t.isSame(now.subtract(1, 'week'), 'week')).length,
  },
  {
    fieldIndex: 3,
    operator: isNot.value,
    queryValue: {
      mode: currentMonth.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 23 - dates.filter((t) => t.isSame(now, 'month')).length,
  },
  {
    fieldIndex: 3,
    operator: isNot.value,
    queryValue: {
      mode: lastMonth.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength:
      23 - dates.filter((t) => t.isSame(now.subtract(1, 'month'), 'month')).length,
  },
  {
    fieldIndex: 3,
    operator: isNot.value,
    queryValue: {
      mode: nextMonthPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 23 - dates.filter((t) => t.isSame(now.add(1, 'month'), 'month')).length,
  },
  {
    fieldIndex: 3,
    operator: isNot.value,
    queryValue: {
      mode: currentYear.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 23 - dates.filter((t) => t.isSame(now, 'year')).length,
  },
  {
    fieldIndex: 3,
    operator: isNot.value,
    queryValue: {
      mode: lastYear.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 23 - dates.filter((t) => t.isSame(now.subtract(1, 'year'), 'year')).length,
  },
  {
    fieldIndex: 3,
    operator: isNot.value,
    queryValue: {
      mode: nextYearPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 23 - dates.filter((t) => t.isSame(now.add(1, 'year'), 'year')).length,
  },
  {
    fieldIndex: 3,
    operator: isNot.value,
    queryValue: {
      mode: oneWeekAgo.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 22,
  },
  {
    fieldIndex: 3,
    operator: isNot.value,
    queryValue: {
      mode: oneWeekFromNow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 22,
  },
  {
    fieldIndex: 3,
    operator: isNot.value,
    queryValue: {
      mode: oneMonthAgo.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 22,
  },
  {
    fieldIndex: 3,
    operator: isNot.value,
    queryValue: {
      mode: oneMonthFromNow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 22,
  },
  {
    fieldIndex: 3,
    operator: isNot.value,
    queryValue: {
      mode: daysAgo.value,
      numberOfDays: 1,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 22,
  },
  {
    fieldIndex: 3,
    operator: isNot.value,
    queryValue: {
      mode: daysFromNow.value,
      numberOfDays: 1,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 22,
  },
  {
    fieldIndex: 3,
    operator: isNot.value,
    queryValue: {
      mode: exactDate.value,
      exactDate: '2019-12-31T16:00:00.000Z',
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 22,
  },
  {
    fieldIndex: 9,
    operator: isNot.value,
    queryValue: {
      mode: exactFormatDate.value,
      exactDate: '2020-01-10T16:00:00.000Z',
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 22,
  },
];

export const LOOKUP_IS_NOT_SETS = [
  {
    operator: isNot.value,
    queryValue: {
      mode: today.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 20,
  },
  {
    operator: isNot.value,
    queryValue: {
      mode: tomorrow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 20,
  },
  {
    operator: isNot.value,
    queryValue: {
      mode: yesterday.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 19,
  },
  {
    operator: isNot.value,
    queryValue: {
      mode: currentWeek.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength:
      21 - lookupDates.filter((dates) => dates.some((t) => t.isSame(now, 'week'))).length,
  },
  {
    operator: isNot.value,
    queryValue: {
      mode: nextWeekPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength:
      21 -
      lookupDates.filter((dates) => dates.some((t) => t.isSame(now.add(1, 'week'), 'week'))).length,
  },
  {
    operator: isNot.value,
    queryValue: {
      mode: lastWeek.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength:
      21 -
      lookupDates.filter((dates) => dates.some((t) => t.isSame(now.subtract(1, 'week'), 'week')))
        .length,
  },
  {
    operator: isNot.value,
    queryValue: {
      mode: currentMonth.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength:
      21 - lookupDates.filter((dates) => dates.some((t) => t.isSame(now, 'month'))).length,
  },
  {
    operator: isNot.value,
    queryValue: {
      mode: lastMonth.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength:
      21 -
      lookupDates.filter((dates) => dates.some((t) => t.isSame(now.subtract(1, 'month'), 'month')))
        .length,
  },
  {
    operator: isNot.value,
    queryValue: {
      mode: nextMonthPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength:
      21 -
      lookupDates.filter((dates) => dates.some((t) => t.isSame(now.add(1, 'month'), 'month')))
        .length,
  },
  {
    operator: isNot.value,
    queryValue: {
      mode: currentYear.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength:
      21 - lookupDates.filter((dates) => dates.some((t) => t.isSame(now, 'year'))).length,
  },
  {
    operator: isNot.value,
    queryValue: {
      mode: lastYear.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength:
      21 -
      lookupDates.filter((dates) => dates.some((t) => t.isSame(now.subtract(1, 'year'), 'year')))
        .length,
  },
  {
    operator: isNot.value,
    queryValue: {
      mode: nextYearPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength:
      21 -
      lookupDates.filter((dates) => dates.some((t) => t.isSame(now.add(1, 'year'), 'year'))).length,
  },
  {
    operator: isNot.value,
    queryValue: {
      mode: oneWeekAgo.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 20,
  },
  {
    operator: isNot.value,
    queryValue: {
      mode: oneWeekFromNow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 20,
  },
  {
    operator: isNot.value,
    queryValue: {
      mode: oneMonthAgo.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 20,
  },
  {
    operator: isNot.value,
    queryValue: {
      mode: oneMonthFromNow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 20,
  },
  {
    operator: isNot.value,
    queryValue: {
      mode: daysAgo.value,
      numberOfDays: 1,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 19,
  },
  {
    operator: isNot.value,
    queryValue: {
      mode: daysFromNow.value,
      numberOfDays: 1,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 20,
  },
  {
    operator: isNot.value,
    queryValue: {
      mode: exactDate.value,
      exactDate: '2019-12-31T16:00:00.000Z',
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 16,
  },
  {
    fieldIndex: 12,
    operator: isNot.value,
    queryValue: {
      mode: exactFormatDate.value,
      exactDate: '2020-01-10T16:00:00.000Z',
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 16,
  },
];
