/* eslint-disable sonarjs/no-duplicate-string */
import {
  currentMonth,
  currentWeek,
  currentYear,
  daysAgo,
  daysFromNow,
  exactDate,
  exactFormatDate,
  is,
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

export const IS_SETS = [
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: today.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 1,
  },
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: tomorrow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 1,
  },
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: yesterday.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 1,
  },
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: currentWeek.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isSame(now, 'week')).length,
  },
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: nextWeekPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isSame(now.add(1, 'week'), 'week')).length,
  },
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: lastWeek.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isSame(now.subtract(1, 'week'), 'week')).length,
  },
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: currentMonth.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isSame(now, 'month')).length,
  },
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: lastMonth.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isSame(now.subtract(1, 'month'), 'month')).length,
  },
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: nextMonthPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isSame(now.add(1, 'month'), 'month')).length,
  },
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: currentYear.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isSame(now, 'year')).length,
  },
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: lastYear.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isSame(now.subtract(1, 'year'), 'year')).length,
  },
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: nextYearPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isSame(now.add(1, 'year'), 'year')).length,
  },
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: oneWeekAgo.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 1,
  },
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: oneWeekFromNow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 1,
  },
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: oneMonthAgo.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 1,
  },
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: oneMonthFromNow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 1,
  },
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: daysAgo.value,
      numberOfDays: 1,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 1,
  },
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: daysFromNow.value,
      numberOfDays: 1,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 1,
  },
  {
    fieldIndex: 3,
    operator: is.value,
    queryValue: {
      mode: exactDate.value,
      exactDate: '2019-12-31T16:00:00.000Z',
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 1,
  },
  {
    fieldIndex: 9,
    operator: is.value,
    queryValue: {
      mode: exactFormatDate.value,
      exactDate: '2020-01-10T16:00:00.000Z',
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 1,
  },
];

export const LOOKUP_IS_SETS = [
  {
    operator: is.value,
    queryValue: {
      mode: today.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 1,
  },
  {
    operator: is.value,
    queryValue: {
      mode: tomorrow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 1,
  },
  {
    operator: is.value,
    queryValue: {
      mode: yesterday.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 2,
  },
  {
    operator: is.value,
    queryValue: {
      mode: currentWeek.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) => dates.some((t) => t.isSame(now, 'week')))
      .length,
  },
  {
    operator: is.value,
    queryValue: {
      mode: nextWeekPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) =>
      dates.some((t) => t.isSame(now.add(1, 'week'), 'week'))
    ).length,
  },
  {
    operator: is.value,
    queryValue: {
      mode: lastWeek.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) =>
      dates.some((t) => t.isSame(now.subtract(1, 'week'), 'week'))
    ).length,
  },
  {
    operator: is.value,
    queryValue: {
      mode: currentMonth.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) => dates.some((t) => t.isSame(now, 'month')))
      .length,
  },
  {
    operator: is.value,
    queryValue: {
      mode: lastMonth.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) =>
      dates.some((t) => t.isSame(now.subtract(1, 'month'), 'month'))
    ).length,
  },
  {
    operator: is.value,
    queryValue: {
      mode: nextMonthPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) =>
      dates.some((t) => t.isSame(now.add(1, 'month'), 'month'))
    ).length,
  },
  {
    operator: is.value,
    queryValue: {
      mode: currentYear.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) => dates.some((t) => t.isSame(now, 'year')))
      .length,
  },
  {
    operator: is.value,
    queryValue: {
      mode: lastYear.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) =>
      dates.some((t) => t.isSame(now.subtract(1, 'year'), 'year'))
    ).length,
  },
  {
    operator: is.value,
    queryValue: {
      mode: nextYearPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) =>
      dates.some((t) => t.isSame(now.add(1, 'year'), 'year'))
    ).length,
  },
  {
    operator: is.value,
    queryValue: {
      mode: oneWeekAgo.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 1,
  },
  {
    operator: is.value,
    queryValue: {
      mode: oneWeekFromNow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 1,
  },
  {
    operator: is.value,
    queryValue: {
      mode: oneMonthAgo.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 1,
  },
  {
    operator: is.value,
    queryValue: {
      mode: oneMonthFromNow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 1,
  },
  {
    operator: is.value,
    queryValue: {
      mode: daysAgo.value,
      numberOfDays: 1,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 2,
  },
  {
    operator: is.value,
    queryValue: {
      mode: daysFromNow.value,
      numberOfDays: 1,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 1,
  },
  {
    operator: is.value,
    queryValue: {
      mode: exactDate.value,
      exactDate: '2019-12-31T16:00:00.000Z',
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 5,
  },
  {
    fieldIndex: 12,
    operator: is.value,
    queryValue: {
      mode: exactFormatDate.value,
      exactDate: '2020-01-10T16:00:00.000Z',
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 5,
  },
];
