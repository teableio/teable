import { StatisticsFunc } from '@teable/core';

export const NUMBER_FIELD_CASES = [
  {
    fieldIndex: 1,
    aggFunc: StatisticsFunc.Sum,
    expectValue: 220,
    expectGroupedCount: 22,
  },
  {
    fieldIndex: 1,
    aggFunc: StatisticsFunc.Average,
    expectValue: 10,
    expectGroupedCount: 22,
  },
  {
    fieldIndex: 1,
    aggFunc: StatisticsFunc.Min,
    expectValue: 0,
    expectGroupedCount: 22,
  },
  {
    fieldIndex: 1,
    aggFunc: StatisticsFunc.Max,
    expectValue: 20,
    expectGroupedCount: 22,
  },
  {
    fieldIndex: 1,
    aggFunc: StatisticsFunc.Count,
    expectValue: 23,
    expectGroupedCount: 22,
  },
  {
    fieldIndex: 1,
    aggFunc: StatisticsFunc.Empty,
    expectValue: 1,
    expectGroupedCount: 22,
  },
  {
    fieldIndex: 1,
    aggFunc: StatisticsFunc.Filled,
    expectValue: 22,
    expectGroupedCount: 22,
  },
  {
    fieldIndex: 1,
    aggFunc: StatisticsFunc.Unique,
    expectValue: 21,
    expectGroupedCount: 22,
  },
  {
    fieldIndex: 1,
    aggFunc: StatisticsFunc.PercentEmpty,
    expectValue: 4.347826,
    expectGroupedCount: 22,
  },
  {
    fieldIndex: 1,
    aggFunc: StatisticsFunc.PercentFilled,
    expectValue: 95.652173,
    expectGroupedCount: 22,
  },
  {
    fieldIndex: 1,
    aggFunc: StatisticsFunc.PercentUnique,
    expectValue: 91.304347,
    expectGroupedCount: 22,
  },
];
