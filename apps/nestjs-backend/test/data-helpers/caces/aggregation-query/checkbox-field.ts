import { StatisticsFunc } from '@teable/core';

export const CHECKBOX_FIELD_CASES = [
  {
    fieldIndex: 4,
    aggFunc: StatisticsFunc.Count,
    expectValue: 23,
    expectGroupedCount: 2,
  },
  {
    fieldIndex: 4,
    aggFunc: StatisticsFunc.Checked,
    expectValue: 4,
    expectGroupedCount: 2,
  },
  {
    fieldIndex: 4,
    aggFunc: StatisticsFunc.UnChecked,
    expectValue: 19,
    expectGroupedCount: 2,
  },
  {
    fieldIndex: 4,
    aggFunc: StatisticsFunc.PercentChecked,
    expectValue: 17.391304,
    expectGroupedCount: 2,
  },
  {
    fieldIndex: 4,
    aggFunc: StatisticsFunc.PercentUnChecked,
    expectValue: 82.608695,
    expectGroupedCount: 2,
  },
];
