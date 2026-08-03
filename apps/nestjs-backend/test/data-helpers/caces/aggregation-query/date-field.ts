import { StatisticsFunc } from '@teable/core';

export const DATE_FIELD_CASES = [
  {
    fieldIndex: 3,
    aggFunc: StatisticsFunc.Count,
    expectValue: 23,
    expectGroupedCount: 18,
  },
  {
    fieldIndex: 3,
    aggFunc: StatisticsFunc.Empty,
    expectValue: 6,
    expectGroupedCount: 18,
  },
  {
    fieldIndex: 3,
    aggFunc: StatisticsFunc.Filled,
    expectValue: 17,
    expectGroupedCount: 18,
  },
  {
    fieldIndex: 3,
    aggFunc: StatisticsFunc.Unique,
    expectValue: 17,
    expectGroupedCount: 18,
  },
  {
    fieldIndex: 3,
    aggFunc: StatisticsFunc.PercentEmpty,
    expectValue: 26.086956,
    expectGroupedCount: 18,
  },
  {
    fieldIndex: 3,
    aggFunc: StatisticsFunc.PercentFilled,
    expectValue: 73.913043,
    expectGroupedCount: 18,
  },
  {
    fieldIndex: 3,
    aggFunc: StatisticsFunc.PercentUnique,
    expectValue: 73.913043,
    expectGroupedCount: 18,
  },
  {
    fieldIndex: 3,
    aggFunc: StatisticsFunc.EarliestDate,
    expectValue: '2019-12-31T16:00:00.000Z',
    expectGroupedCount: 18,
  },
  {
    fieldIndex: 3,
    aggFunc: StatisticsFunc.LatestDate,
    expectValue: '2099-12-31T15:59:59.000Z',
    expectGroupedCount: 18,
  },
  {
    fieldIndex: 3,
    aggFunc: StatisticsFunc.DateRangeOfDays,
    expectValue: 29219,
    expectGroupedCount: 18,
  },
  {
    fieldIndex: 3,
    aggFunc: StatisticsFunc.DateRangeOfMonths,
    expectValue: 959,
    expectGroupedCount: 18,
  },
];
