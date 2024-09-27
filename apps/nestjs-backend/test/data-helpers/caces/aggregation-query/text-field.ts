import { StatisticsFunc } from '@teable/core';

export const TEXT_FIELD_CASES = [
  {
    fieldIndex: 0,
    aggFunc: StatisticsFunc.Count,
    expectValue: 23,
    expectGroupedCount: 22,
  },
  {
    fieldIndex: 0,
    aggFunc: StatisticsFunc.Empty,
    expectValue: 1,
    expectGroupedCount: 22,
  },
  {
    fieldIndex: 0,
    aggFunc: StatisticsFunc.Filled,
    expectValue: 22,
    expectGroupedCount: 22,
  },
  {
    fieldIndex: 0,
    aggFunc: StatisticsFunc.Unique,
    expectValue: 21,
    expectGroupedCount: 22,
  },
  {
    fieldIndex: 0,
    aggFunc: StatisticsFunc.PercentEmpty,
    expectValue: 4.347826,
    expectGroupedCount: 22,
  },
  {
    fieldIndex: 0,
    aggFunc: StatisticsFunc.PercentFilled,
    expectValue: 95.652173,
    expectGroupedCount: 22,
  },
  {
    fieldIndex: 0,
    aggFunc: StatisticsFunc.PercentUnique,
    expectValue: 91.304347,
    expectGroupedCount: 22,
  },
];
