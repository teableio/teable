import { StatisticsFunc } from '@teable/core';

export const NUMBER_FIELD_CASES = [
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
    fieldIndex: 1,
    aggFunc: StatisticsFunc.Min,
    expectValue: 0,
  },
  {
    fieldIndex: 1,
    aggFunc: StatisticsFunc.Max,
    expectValue: 20,
  },
  {
    fieldIndex: 1,
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
    fieldIndex: 1,
    aggFunc: StatisticsFunc.PercentEmpty,
    expectValue: 4.347826,
  },
  {
    fieldIndex: 1,
    aggFunc: StatisticsFunc.PercentFilled,
    expectValue: 95.652173,
  },
  {
    fieldIndex: 1,
    aggFunc: StatisticsFunc.PercentUnique,
    expectValue: 91.304347,
  },
];
