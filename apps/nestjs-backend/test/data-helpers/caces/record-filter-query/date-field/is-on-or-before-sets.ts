/* eslint-disable sonarjs/no-duplicate-string */
import {
  currentMonth,
  currentWeek,
  currentYear,
  daysAgo,
  daysFromNow,
  exactDate,
  exactFormatDate,
  isOnOrBefore,
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

export const IS_ON_OR_BEFORE_SETS = [
  {
    fieldIndex: 3,
    operator: isOnOrBefore.value,
    queryValue: {
      mode: today.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 12,
  },
  {
    fieldIndex: 3,
    operator: isOnOrBefore.value,
    queryValue: {
      mode: tomorrow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 13,
  },
  {
    fieldIndex: 3,
    operator: isOnOrBefore.value,
    queryValue: {
      mode: yesterday.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 11,
  },
  {
    fieldIndex: 3,
    operator: isOnOrBefore.value,
    queryValue: {
      mode: currentWeek.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isBefore(now.add(1, 'week'), 'week')).length,
  },
  {
    fieldIndex: 3,
    operator: isOnOrBefore.value,
    queryValue: {
      mode: nextWeekPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isBefore(now.add(2, 'week'), 'week')).length,
  },
  {
    fieldIndex: 3,
    operator: isOnOrBefore.value,
    queryValue: {
      mode: lastWeek.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isBefore(now, 'week')).length,
  },
  {
    fieldIndex: 3,
    operator: isOnOrBefore.value,
    queryValue: {
      mode: currentMonth.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isBefore(now.add(1, 'month'), 'month')).length,
  },
  {
    fieldIndex: 3,
    operator: isOnOrBefore.value,
    queryValue: {
      mode: lastMonth.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isBefore(now, 'month')).length,
  },
  {
    fieldIndex: 3,
    operator: isOnOrBefore.value,
    queryValue: {
      mode: nextMonthPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isBefore(now.add(2, 'month'), 'month')).length,
  },
  {
    fieldIndex: 3,
    operator: isOnOrBefore.value,
    queryValue: {
      mode: currentYear.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isBefore(now.add(1, 'year'), 'year')).length,
  },
  {
    fieldIndex: 3,
    operator: isOnOrBefore.value,
    queryValue: {
      mode: lastYear.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isBefore(now, 'year')).length,
  },
  {
    fieldIndex: 3,
    operator: isOnOrBefore.value,
    queryValue: {
      mode: nextYearPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: dates.filter((t) => t.isBefore(now.add(2, 'year'), 'year')).length,
  },
  {
    fieldIndex: 3,
    operator: isOnOrBefore.value,
    queryValue: {
      mode: oneWeekAgo.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 10,
  },
  {
    fieldIndex: 3,
    operator: isOnOrBefore.value,
    queryValue: {
      mode: oneWeekFromNow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 14,
  },
  {
    fieldIndex: 3,
    operator: isOnOrBefore.value,
    queryValue: {
      mode: oneMonthAgo.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 9,
  },
  {
    fieldIndex: 3,
    operator: isOnOrBefore.value,
    queryValue: {
      mode: oneMonthFromNow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 15,
  },
  {
    fieldIndex: 3,
    operator: isOnOrBefore.value,
    queryValue: {
      mode: daysAgo.value,
      numberOfDays: 1,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 11,
  },
  {
    fieldIndex: 3,
    operator: isOnOrBefore.value,
    queryValue: {
      mode: daysFromNow.value,
      numberOfDays: 1,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 13,
  },
  {
    fieldIndex: 3,
    operator: isOnOrBefore.value,
    queryValue: {
      mode: exactDate.value,
      exactDate: '2019-12-31T16:00:00.000Z',
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 1,
  },
  {
    fieldIndex: 9,
    operator: isOnOrBefore.value,
    queryValue: {
      mode: exactFormatDate.value,
      exactDate: '2020-01-10T16:00:00.000Z',
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 1,
  },
];

export const LOOKUP_IS_ON_OR_BEFORE_SETS = [
  {
    operator: isOnOrBefore.value,
    queryValue: {
      mode: today.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 14,
  },
  {
    operator: isOnOrBefore.value,
    queryValue: {
      mode: tomorrow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 14,
  },
  {
    operator: isOnOrBefore.value,
    queryValue: {
      mode: yesterday.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 13,
  },
  {
    operator: isOnOrBefore.value,
    queryValue: {
      mode: currentWeek.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) =>
      dates.some((t) => t.isBefore(now.add(1, 'week'), 'week'))
    ).length,
  },
  {
    operator: isOnOrBefore.value,
    queryValue: {
      mode: nextWeekPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) =>
      dates.some((t) => t.isBefore(now.add(2, 'week'), 'week'))
    ).length,
  },
  {
    operator: isOnOrBefore.value,
    queryValue: {
      mode: lastWeek.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) => dates.some((t) => t.isBefore(now, 'week')))
      .length,
  },
  {
    operator: isOnOrBefore.value,
    queryValue: {
      mode: currentMonth.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) =>
      dates.some((t) => t.isBefore(now.add(1, 'month'), 'month'))
    ).length,
  },
  {
    operator: isOnOrBefore.value,
    queryValue: {
      mode: lastMonth.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) => dates.some((t) => t.isBefore(now, 'month')))
      .length,
  },
  {
    operator: isOnOrBefore.value,
    queryValue: {
      mode: nextMonthPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) =>
      dates.some((t) => t.isBefore(now.add(2, 'month'), 'month'))
    ).length,
  },
  {
    operator: isOnOrBefore.value,
    queryValue: {
      mode: currentYear.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) =>
      dates.some((t) => t.isBefore(now.add(1, 'year'), 'year'))
    ).length,
  },
  {
    operator: isOnOrBefore.value,
    queryValue: {
      mode: lastYear.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) => dates.some((t) => t.isBefore(now, 'year')))
      .length,
  },
  {
    operator: isOnOrBefore.value,
    queryValue: {
      mode: nextYearPeriod.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: lookupDates.filter((dates) =>
      dates.some((t) => t.isBefore(now.add(2, 'year'), 'year'))
    ).length,
  },
  {
    operator: isOnOrBefore.value,
    queryValue: {
      mode: oneWeekAgo.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 13,
  },
  {
    operator: isOnOrBefore.value,
    queryValue: {
      mode: oneWeekFromNow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 14,
  },
  {
    operator: isOnOrBefore.value,
    queryValue: {
      mode: oneMonthAgo.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 12,
  },
  {
    operator: isOnOrBefore.value,
    queryValue: {
      mode: oneMonthFromNow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 14,
  },
  {
    operator: isOnOrBefore.value,
    queryValue: {
      mode: daysAgo.value,
      numberOfDays: 1,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 13,
  },
  {
    operator: isOnOrBefore.value,
    queryValue: {
      mode: daysFromNow.value,
      numberOfDays: 1,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 14,
  },
  {
    operator: isOnOrBefore.value,
    queryValue: {
      mode: exactDate.value,
      exactDate: '2019-12-31T16:00:00.000Z',
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 5,
  },
  {
    fieldIndex: 12,
    operator: isOnOrBefore.value,
    queryValue: {
      mode: exactFormatDate.value,
      exactDate: '2020-01-10T16:00:00.000Z',
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 5,
  },
];
