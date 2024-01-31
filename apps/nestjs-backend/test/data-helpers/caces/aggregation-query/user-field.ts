import { StatisticsFunc } from '@teable/core';

export const USER_FIELD_CASES = [
  {
    fieldIndex: 5,
    aggFunc: StatisticsFunc.Empty,
    expectValue: 22,
  },
  {
    fieldIndex: 5,
    aggFunc: StatisticsFunc.Filled,
    expectValue: 1,
  },
  {
    fieldIndex: 5,
    aggFunc: StatisticsFunc.PercentEmpty,
    expectValue: 95.652173,
  },
  {
    fieldIndex: 5,
    aggFunc: StatisticsFunc.PercentFilled,
    expectValue: 4.347826,
  },
  {
    fieldIndex: 5,
    aggFunc: StatisticsFunc.Unique,
    expectValue: 1,
  },
  {
    fieldIndex: 5,
    aggFunc: StatisticsFunc.PercentUnique,
    expectValue: 4.347826,
  },
];

export const MULTIPLE_USER_FIELD_CASES = [
  {
    fieldIndex: 7,
    aggFunc: StatisticsFunc.Empty,
    expectValue: 1,
  },
  {
    fieldIndex: 7,
    aggFunc: StatisticsFunc.Filled,
    expectValue: 22,
  },
  {
    fieldIndex: 7,
    aggFunc: StatisticsFunc.PercentEmpty,
    expectValue: 21,
  },
  {
    fieldIndex: 7,
    aggFunc: StatisticsFunc.PercentFilled,
    expectValue: 4.347826,
  },
];
