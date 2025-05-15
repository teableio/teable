/* eslint-disable sonarjs/no-duplicate-string */
import {
  currentMonth,
  currentWeek,
  currentYear,
  daysAgo,
  daysFromNow,
  exactDate,
  exactFormatDate,
  isAfter,
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

export const IS_AFTER_SETS = [
  {
    fieldIndex: 3,
    operator: isAfter.value,
    queryValue: {
      mode: today.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 5,
  },
  {
    fieldIndex: 3,
    operator: isAfter.value,
    queryValue: {
      mode: tomorrow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 4,
  },
  {
    fieldIndex: 3,
    operator: isAfter.value,
    queryValue: {
      mode: yesterday.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 6,
  },
  {
    fieldIndex: 3,
    operator: isAfter.value,
    queryValue: {
      mode: currentWeek.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isAfter(now, 'week')).length,
  },
  {
    fieldIndex: 3,
    operator: isAfter.value,
    queryValue: {
      mode: nextWeekPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isAfter(now.add(1, 'week'), 'week')).length,
  },
  {
    fieldIndex: 3,
    operator: isAfter.value,
    queryValue: {
      mode: lastWeek.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isAfter(now.subtract(1, 'week'), 'week')).length,
  },
  {
    fieldIndex: 3,
    operator: isAfter.value,
    queryValue: {
      mode: currentMonth.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isAfter(now, 'month')).length,
  },
  {
    fieldIndex: 3,
    operator: isAfter.value,
    queryValue: {
      mode: lastMonth.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isAfter(now.subtract(1, 'month'), 'month')).length,
  },
  {
    fieldIndex: 3,
    operator: isAfter.value,
    queryValue: {
      mode: nextMonthPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isAfter(now.add(1, 'month'), 'month')).length,
  },
  {
    fieldIndex: 3,
    operator: isAfter.value,
    queryValue: {
      mode: currentYear.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isAfter(now, 'year')).length,
  },
  {
    fieldIndex: 3,
    operator: isAfter.value,
    queryValue: {
      mode: lastYear.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isAfter(now.subtract(1, 'year'), 'year')).length,
  },
  {
    fieldIndex: 3,
    operator: isAfter.value,
    queryValue: {
      mode: nextYearPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isAfter(now.add(1, 'year'), 'year')).length,
  },
  {
    fieldIndex: 3,
    operator: isAfter.value,
    queryValue: {
      mode: oneWeekAgo.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 7,
  },
  {
    fieldIndex: 3,
    operator: isAfter.value,
    queryValue: {
      mode: oneWeekFromNow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 3,
  },
  {
    fieldIndex: 3,
    operator: isAfter.value,
    queryValue: {
      mode: oneMonthAgo.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 8,
  },
  {
    fieldIndex: 3,
    operator: isAfter.value,
    queryValue: {
      mode: oneMonthFromNow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 2,
  },
  {
    fieldIndex: 3,
    operator: isAfter.value,
    queryValue: {
      mode: daysAgo.value,
      numberOfDays: 1,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 6,
  },
  {
    fieldIndex: 3,
    operator: isAfter.value,
    queryValue: {
      mode: daysFromNow.value,
      numberOfDays: 1,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 4,
  },
  {
    fieldIndex: 3,
    operator: isAfter.value,
    queryValue: {
      mode: exactDate.value,
      exactDate: '2019-12-31T16:00:00.000Z',
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 16,
  },
  {
    fieldIndex: 9,
    operator: isAfter.value,
    queryValue: {
      mode: exactFormatDate.value,
      exactDate: '2020-01-10T16:00:00.000Z',
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 16,
  },
];

export const LOOKUP_IS_AFTER_SETS = [
  {
    operator: isAfter.value,
    queryValue: {
      mode: today.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 4,
  },
  {
    operator: isAfter.value,
    queryValue: {
      mode: tomorrow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 3,
  },
  {
    operator: isAfter.value,
    queryValue: {
      mode: yesterday.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 4,
  },
  {
    operator: isAfter.value,
    queryValue: {
      mode: currentWeek.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) => dates.some((t) => t.isAfter(now, 'week')))
      .length,
  },
  {
    operator: isAfter.value,
    queryValue: {
      mode: nextWeekPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) =>
      dates.some((t) => t.isAfter(now.add(1, 'week'), 'week'))
    ).length,
  },
  {
    operator: isAfter.value,
    queryValue: {
      mode: lastWeek.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) =>
      dates.some((t) => t.isAfter(now.subtract(1, 'week'), 'week'))
    ).length,
  },
  {
    operator: isAfter.value,
    queryValue: {
      mode: currentMonth.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) => dates.some((t) => t.isAfter(now, 'month')))
      .length,
  },
  {
    operator: isAfter.value,
    queryValue: {
      mode: lastMonth.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) =>
      dates.some((t) => t.isAfter(now.subtract(1, 'month'), 'month'))
    ).length,
  },
  {
    operator: isAfter.value,
    queryValue: {
      mode: nextMonthPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) =>
      dates.some((t) => t.isAfter(now.add(1, 'month'), 'month'))
    ).length,
  },
  {
    operator: isAfter.value,
    queryValue: {
      mode: currentYear.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) => dates.some((t) => t.isAfter(now, 'year')))
      .length,
  },
  {
    operator: isAfter.value,
    queryValue: {
      mode: lastYear.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) =>
      dates.some((t) => t.isAfter(now.subtract(1, 'year'), 'year'))
    ).length,
  },
  {
    operator: isAfter.value,
    queryValue: {
      mode: nextYearPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) =>
      dates.some((t) => t.isAfter(now.add(1, 'year'), 'year'))
    ).length,
  },
  {
    operator: isAfter.value,
    queryValue: {
      mode: oneWeekAgo.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 4,
  },
  {
    operator: isAfter.value,
    queryValue: {
      mode: oneWeekFromNow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 3,
  },
  {
    operator: isAfter.value,
    queryValue: {
      mode: oneMonthAgo.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 4,
  },
  {
    operator: isAfter.value,
    queryValue: {
      mode: oneMonthFromNow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 2,
  },
  {
    operator: isAfter.value,
    queryValue: {
      mode: daysAgo.value,
      numberOfDays: 1,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 4,
  },
  {
    operator: isAfter.value,
    queryValue: {
      mode: daysFromNow.value,
      numberOfDays: 1,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 3,
  },
  {
    operator: isAfter.value,
    queryValue: {
      mode: exactDate.value,
      exactDate: '2019-12-31T16:00:00.000Z',
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 10,
  },
  {
    fieldIndex: 12,
    operator: isAfter.value,
    queryValue: {
      mode: exactFormatDate.value,
      exactDate: '2020-01-10T16:00:00.000Z',
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 10,
  },
];
