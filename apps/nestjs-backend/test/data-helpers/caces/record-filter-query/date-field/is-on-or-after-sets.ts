/* eslint-disable sonarjs/no-duplicate-string */
import {
  daysAgo,
  daysFromNow,
  exactDate,
  isOnOrAfter,
  oneMonthAgo,
  oneMonthFromNow,
  oneWeekAgo,
  oneWeekFromNow,
  today,
  tomorrow,
  yesterday,
} from '@teable/core';

export const IS_ON_OR_AFTER_SETS = [
  {
    fieldIndex: 3,
    operator: isOnOrAfter.value,
    queryValue: {
      mode: today.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 6,
  },
  {
    fieldIndex: 3,
    operator: isOnOrAfter.value,
    queryValue: {
      mode: tomorrow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 5,
  },
  {
    fieldIndex: 3,
    operator: isOnOrAfter.value,
    queryValue: {
      mode: yesterday.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 7,
  },
  {
    fieldIndex: 3,
    operator: isOnOrAfter.value,
    queryValue: {
      mode: oneWeekAgo.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 8,
  },
  {
    fieldIndex: 3,
    operator: isOnOrAfter.value,
    queryValue: {
      mode: oneWeekFromNow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 4,
  },
  {
    fieldIndex: 3,
    operator: isOnOrAfter.value,
    queryValue: {
      mode: oneMonthAgo.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 9,
  },
  {
    fieldIndex: 3,
    operator: isOnOrAfter.value,
    queryValue: {
      mode: oneMonthFromNow.value,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 3,
  },
  {
    fieldIndex: 3,
    operator: isOnOrAfter.value,
    queryValue: {
      mode: daysAgo.value,
      numberOfDays: 1,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 7,
  },
  {
    fieldIndex: 3,
    operator: isOnOrAfter.value,
    queryValue: {
      mode: daysFromNow.value,
      numberOfDays: 1,
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 5,
  },
  {
    fieldIndex: 3,
    operator: isOnOrAfter.value,
    queryValue: {
      mode: exactDate.value,
      exactDate: '2019-12-31T16:00:00.000Z',
      timeZone: 'Asia/Singapore',
    },
    expectResultLength: 17,
  },
];
