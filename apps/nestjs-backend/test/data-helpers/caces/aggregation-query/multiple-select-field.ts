import { StatisticsFunc } from '@teable/core';

export const MULTIPLE_SELECT_FIELD_CASES = [
  {
    fieldIndex: 6,
    aggFunc: StatisticsFunc.Empty,
    expectValue: 15,
  },
  {
    fieldIndex: 6,
    aggFunc: StatisticsFunc.Filled,
    expectValue: 8,
  },
  {
    fieldIndex: 6,
    aggFunc: StatisticsFunc.Unique,
    expectValue: 3,
  },
  {
    fieldIndex: 6,
    aggFunc: StatisticsFunc.PercentEmpty,
    expectValue: 65.217391,
  },
  {
    fieldIndex: 6,
    aggFunc: StatisticsFunc.PercentFilled,
    expectValue: 34.782608,
  },
  {
    fieldIndex: 6,
    aggFunc: StatisticsFunc.PercentUnique,
    expectValue: 20,
  },
];
