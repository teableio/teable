import { StatisticsFunc } from '@teable/core';

export const TEXT_FIELD_CASES = [
  {
    fieldIndex: 0,
    aggFunc: StatisticsFunc.Count,
    expectValue: 23,
    expectGroupedCount: 21,
  },
  {
    fieldIndex: 0,
    aggFunc: StatisticsFunc.Empty,
    expectValue: 2,
    expectGroupedCount: 21,
  },
  {
    fieldIndex: 0,
    aggFunc: StatisticsFunc.Filled,
    expectValue: 21,
    expectGroupedCount: 21,
  },
  {
    fieldIndex: 0,
    aggFunc: StatisticsFunc.Unique,
    expectValue: 20,
    expectGroupedCount: 21,
  },
  {
    fieldIndex: 0,
    aggFunc: StatisticsFunc.PercentEmpty,
    expectValue: 8.695652,
    expectGroupedCount: 21,
  },
  {
    fieldIndex: 0,
    aggFunc: StatisticsFunc.PercentFilled,
    expectValue: 91.304347,
    expectGroupedCount: 21,
  },
  {
    fieldIndex: 0,
    aggFunc: StatisticsFunc.PercentUnique,
    expectValue: 86.956521,
    expectGroupedCount: 21,
  },
];
