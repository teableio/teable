import { StatisticsFunc } from '@teable/core';

export const DATE_FIELD_CASES = [
  {
    fieldIndex: 3,
    aggFunc: StatisticsFunc.Empty,
    expectValue: 6,
  },
  {
    fieldIndex: 3,
    aggFunc: StatisticsFunc.Filled,
    expectValue: 17,
  },
  {
    fieldIndex: 3,
    aggFunc: StatisticsFunc.Unique,
    expectValue: 17,
  },
  {
    fieldIndex: 3,
    aggFunc: StatisticsFunc.PercentEmpty,
    expectValue: 26.086956,
  },
  {
    fieldIndex: 3,
    aggFunc: StatisticsFunc.PercentFilled,
    expectValue: 73.913043,
  },
  {
    fieldIndex: 3,
    aggFunc: StatisticsFunc.PercentUnique,
    expectValue: 73.913043,
  },
  {
    fieldIndex: 3,
    aggFunc: StatisticsFunc.EarliestDate,
    expectValue: '2019-12-31T16:00:00.000Z',
  },
  {
    fieldIndex: 3,
    aggFunc: StatisticsFunc.LatestDate,
    expectValue: '2099-12-31T15:59:59.000Z',
  },
  {
    fieldIndex: 3,
    aggFunc: StatisticsFunc.DateRangeOfDays,
    expectValue: 29219,
  },
  {
    fieldIndex: 3,
    aggFunc: StatisticsFunc.DateRangeOfMonths,
    expectValue: 959,
  },
];
