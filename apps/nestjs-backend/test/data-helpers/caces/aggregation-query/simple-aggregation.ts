import { StatisticsFunc } from '@teable/core';

export const SIMPLE_AGGREGATION_CACES = [
  {
    fieldIndex: 0,
    aggFunc: StatisticsFunc.Empty,
    expectValue: 1,
  },
  {
    fieldIndex: 1,
    aggFunc: StatisticsFunc.Filled,
    expectValue: 22,
  },
  {
    fieldIndex: 1,
    aggFunc: StatisticsFunc.Unique,
    expectValue: 21,
  },
  {
    // user field
    fieldIndex: 5,
    aggFunc: StatisticsFunc.Unique,
    expectValue: 1,
  },
  {
    fieldIndex: 1,
    aggFunc: StatisticsFunc.Max,
    expectValue: 20,
  },
  {
    fieldIndex: 1,
    aggFunc: StatisticsFunc.Min,
    expectValue: 0,
  },
  {
    fieldIndex: 1,
    aggFunc: StatisticsFunc.Sum,
    expectValue: 220,
  },
  {
    fieldIndex: 1,
    aggFunc: StatisticsFunc.Average,
    expectValue: 10,
  },
  {
    fieldIndex: 4,
    aggFunc: StatisticsFunc.Checked,
    expectValue: 4,
  },
  {
    fieldIndex: 4,
    aggFunc: StatisticsFunc.UnChecked,
    expectValue: 19,
  },
  {
    fieldIndex: 2,
    aggFunc: StatisticsFunc.PercentEmpty,
    expectValue: 47.826086,
  },
  {
    fieldIndex: 0,
    aggFunc: StatisticsFunc.PercentFilled,
    expectValue: 95.652173,
  },
  {
    fieldIndex: 2,
    aggFunc: StatisticsFunc.PercentUnique,
    expectValue: 13.043478,
  },
  {
    fieldIndex: 4,
    aggFunc: StatisticsFunc.PercentChecked,
    expectValue: 17.391304,
  },
  {
    fieldIndex: 4,
    aggFunc: StatisticsFunc.PercentUnChecked,
    expectValue: 82.608695,
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
