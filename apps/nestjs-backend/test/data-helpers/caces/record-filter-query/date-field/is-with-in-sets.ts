/* eslint-disable sonarjs/no-duplicate-string */
import {
  isWithIn,
  nextMonth,
  nextNumberOfDays,
  nextWeek,
  nextYear,
  pastMonth,
  pastNumberOfDays,
  pastWeek,
  pastYear,
} from '@teable/core';

export const IS_WITH_IN_SETS = [
  {
    fieldIndex: 3,
    operator: isWithIn.value,
    queryValue: {
      mode: pastWeek.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 3,
  },
  {
    fieldIndex: 3,
    operator: isWithIn.value,
    queryValue: {
      mode: pastMonth.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 4,
  },
  {
    fieldIndex: 3,
    operator: isWithIn.value,
    queryValue: {
      mode: pastYear.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 5,
  },
  {
    fieldIndex: 3,
    operator: isWithIn.value,
    queryValue: {
      mode: nextWeek.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 3,
  },
  {
    fieldIndex: 3,
    operator: isWithIn.value,
    queryValue: {
      mode: nextMonth.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 4,
  },
  {
    fieldIndex: 3,
    operator: isWithIn.value,
    queryValue: {
      mode: nextYear.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 5,
  },
  {
    fieldIndex: 3,
    operator: isWithIn.value,
    queryValue: {
      mode: pastNumberOfDays.value,
      numberOfDays: 1,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 2,
  },
  {
    fieldIndex: 3,
    operator: isWithIn.value,
    queryValue: {
      mode: nextNumberOfDays.value,
      numberOfDays: 1,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 2,
  },
];

export const LOOKUP_IS_WITH_IN_SETS = [
  {
    fieldIndex: 6,
    operator: isWithIn.value,
    queryValue: {
      mode: pastWeek.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 3,
  },
  {
    fieldIndex: 6,
    operator: isWithIn.value,
    queryValue: {
      mode: pastMonth.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 4,
  },
  {
    fieldIndex: 6,
    operator: isWithIn.value,
    queryValue: {
      mode: pastYear.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 4,
  },
  {
    fieldIndex: 6,
    operator: isWithIn.value,
    queryValue: {
      mode: nextWeek.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 3,
  },
  {
    fieldIndex: 6,
    operator: isWithIn.value,
    queryValue: {
      mode: nextMonth.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 3,
  },
  {
    fieldIndex: 6,
    operator: isWithIn.value,
    queryValue: {
      mode: nextYear.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 4,
  },
  {
    fieldIndex: 6,
    operator: isWithIn.value,
    queryValue: {
      mode: pastNumberOfDays.value,
      numberOfDays: 1,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 3,
  },
  {
    fieldIndex: 6,
    operator: isWithIn.value,
    queryValue: {
      mode: nextNumberOfDays.value,
      numberOfDays: 1,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 2,
  },
];
