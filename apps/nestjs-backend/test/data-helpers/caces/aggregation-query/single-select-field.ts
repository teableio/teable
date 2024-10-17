import { StatisticsFunc } from '@teable/core';

export const SINGLE_SELECT_FIELD_CASES = [
  {
    fieldIndex: 2,
    aggFunc: StatisticsFunc.Count,
    expectValue: 23,
    expectGroupedCount: 4,
  },
  {
    fieldIndex: 2,
    aggFunc: StatisticsFunc.Empty,
    expectValue: 11,
    expectGroupedCount: 4,
  },
  {
    fieldIndex: 2,
    aggFunc: StatisticsFunc.Filled,
    expectValue: 12,
    expectGroupedCount: 4,
  },
  {
    fieldIndex: 2,
    aggFunc: StatisticsFunc.Unique,
    expectValue: 3,
    expectGroupedCount: 4,
  },
  {
    fieldIndex: 2,
    aggFunc: StatisticsFunc.PercentEmpty,
    expectValue: 47.8260869,
    expectGroupedCount: 4,
  },
  {
    fieldIndex: 2,
    aggFunc: StatisticsFunc.PercentFilled,
    expectValue: 52.173913,
    expectGroupedCount: 4,
  },
  {
    fieldIndex: 2,
    aggFunc: StatisticsFunc.PercentUnique,
    expectValue: 13.043478,
    expectGroupedCount: 4,
  },
];
