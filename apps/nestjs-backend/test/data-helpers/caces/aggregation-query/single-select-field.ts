import { StatisticsFunc } from '@teable/core';

export const SINGLE_SELECT_FIELD_CASES = [
  {
    fieldIndex: 2,
    aggFunc: StatisticsFunc.Empty,
    expectValue: 11,
  },
  {
    fieldIndex: 2,
    aggFunc: StatisticsFunc.Filled,
    expectValue: 12,
  },
  {
    fieldIndex: 2,
    aggFunc: StatisticsFunc.Unique,
    expectValue: 3,
  },
  {
    fieldIndex: 2,
    aggFunc: StatisticsFunc.PercentEmpty,
    expectValue: 47.8260869,
  },
  {
    fieldIndex: 2,
    aggFunc: StatisticsFunc.PercentFilled,
    expectValue: 52.173913,
  },
  {
    fieldIndex: 2,
    aggFunc: StatisticsFunc.PercentUnique,
    expectValue: 13.043478,
  },
];
