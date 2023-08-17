/* eslint-disable sonarjs/no-duplicate-string */
import { CellValueType, FieldType, StatisticsFunc } from '@teable-group/core';
import type { IFieldInstance } from '@teable-group/sdk';

export const statisticFunc2NameMap = {
  [StatisticsFunc.Empty]: 'Empty',
  [StatisticsFunc.Filled]: 'Filled',
  [StatisticsFunc.Unique]: 'Unique',
  [StatisticsFunc.Max]: 'Max',
  [StatisticsFunc.Min]: 'Min',
  [StatisticsFunc.Sum]: 'Sum',
  [StatisticsFunc.Average]: 'Average',
  [StatisticsFunc.Checked]: 'Checked',
  [StatisticsFunc.UnChecked]: 'Unchecked',
  [StatisticsFunc.PercentEmpty]: 'Percent Empty',
  [StatisticsFunc.PercentFilled]: 'Percent Filled',
  [StatisticsFunc.PercentUnique]: 'Percent Unique',
  [StatisticsFunc.PercentChecked]: 'Percent Checked',
  [StatisticsFunc.PercentUnChecked]: 'Percent Unchecked',
  [StatisticsFunc.EarliestDate]: 'Earliest Date',
  [StatisticsFunc.LatestDate]: 'Latest Date',
  [StatisticsFunc.DateRangeOfDays]: 'Date Range (days)',
  [StatisticsFunc.DateRangeOfMonths]: 'Date Range (months)',
};

export const getValidStatisticFunc = (field?: IFieldInstance) => {
  if (!field) {
    return [];
  }

  const { cellValueType, type } = field;

  if (type === FieldType.Link) {
    return [
      { type: 'None', name: 'None' },
      { type: StatisticsFunc.Empty, name: 'Empty' },
      { type: StatisticsFunc.Filled, name: 'Filled' },
      { type: StatisticsFunc.PercentEmpty, name: 'Percent Empty' },
      { type: StatisticsFunc.PercentFilled, name: 'Percent Filled' },
    ];
  }

  switch (cellValueType) {
    case CellValueType.String:
      return [
        { type: 'None', name: 'None' },
        { type: StatisticsFunc.Empty, name: 'Empty' },
        { type: StatisticsFunc.Filled, name: 'Filled' },
        { type: StatisticsFunc.Unique, name: 'Unique' },
        { type: StatisticsFunc.PercentEmpty, name: 'Percent Empty' },
        { type: StatisticsFunc.PercentFilled, name: 'Percent Filled' },
        { type: StatisticsFunc.PercentUnique, name: 'Percent Unique' },
      ];
    case CellValueType.Number:
      return [
        { type: 'None', name: 'None' },
        { type: StatisticsFunc.Sum, name: 'Sum' },
        { type: StatisticsFunc.Average, name: 'Average' },
        { type: StatisticsFunc.Min, name: 'Min' },
        { type: StatisticsFunc.Max, name: 'Max' },
        { type: StatisticsFunc.Empty, name: 'Empty' },
        { type: StatisticsFunc.Filled, name: 'Filled' },
        { type: StatisticsFunc.Unique, name: 'Unique' },
        { type: StatisticsFunc.PercentEmpty, name: 'Percent Empty' },
        { type: StatisticsFunc.PercentFilled, name: 'Percent Filled' },
        { type: StatisticsFunc.PercentUnique, name: 'Percent Unique' },
      ];
    case CellValueType.DateTime:
      return [
        { type: 'None', name: 'None' },
        { type: StatisticsFunc.Empty, name: 'Empty' },
        { type: StatisticsFunc.Filled, name: 'Filled' },
        { type: StatisticsFunc.Unique, name: 'Unique' },
        { type: StatisticsFunc.PercentEmpty, name: 'Percent Empty' },
        { type: StatisticsFunc.PercentFilled, name: 'Percent Filled' },
        { type: StatisticsFunc.PercentUnique, name: 'Percent Unique' },
        { type: StatisticsFunc.EarliestDate, name: 'Earliest Date' },
        { type: StatisticsFunc.LatestDate, name: 'Latest Date' },
        { type: StatisticsFunc.DateRangeOfDays, name: 'Date Range (days)' },
        { type: StatisticsFunc.DateRangeOfMonths, name: 'Date Range (months)' },
      ];
    case CellValueType.Boolean:
      return [
        { type: 'None', name: 'None' },
        { type: StatisticsFunc.Checked, name: 'Checked' },
        { type: StatisticsFunc.UnChecked, name: 'Unchecked' },
        { type: StatisticsFunc.PercentChecked, name: 'Percent Checked' },
        { type: StatisticsFunc.PercentUnChecked, name: 'Percent Unchecked' },
      ];
  }
};
