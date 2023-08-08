/* eslint-disable sonarjs/no-duplicate-string */
import { CellValueType, StatisticsFunc } from '@teable-group/core';

export const getStatisticsMapByValueType = (type?: CellValueType) => {
  switch (type) {
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
        { type: StatisticsFunc.Min, name: 'Earliest Date' },
        { type: StatisticsFunc.Max, name: 'Latest Date' },
        { type: StatisticsFunc.DateRangeOfDays, name: 'Date Range (days)' },
        { type: StatisticsFunc.DateRangeOfMonths, name: 'Date Range (months)' },
      ];
    case CellValueType.Boolean:
      return [
        { type: 'None', name: 'None' },
        { type: StatisticsFunc.Checked, name: 'Checked' },
        { type: StatisticsFunc.UnChecked, name: 'UnChecked' },
        { type: StatisticsFunc.PercentChecked, name: 'Percent Checked' },
        { type: StatisticsFunc.PercentUnChecked, name: 'Percent UnChecked' },
      ];
    default:
      return [];
  }
};
