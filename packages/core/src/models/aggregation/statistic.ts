import { pullAll } from 'lodash';
import type { FieldCore } from '../field';
import { CellValueType, FieldType } from '../field';
import { NoneFunc, StatisticsFunc } from './statistics-func.enum';

export const statisticFunc2NameMap = {
  [NoneFunc.None]: 'None',
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
  [StatisticsFunc.TotalAttachmentSize]: 'Total Attachment Size',
};

export const getValidStatisticFunc = (field?: FieldCore): StatisticsFunc[] => {
  let statisticSet: StatisticsFunc[] = [];
  if (!field) {
    return statisticSet;
  }

  const { cellValueType, type } = field;

  if (type === FieldType.Link) {
    statisticSet = [
      StatisticsFunc.Empty,
      StatisticsFunc.Filled,
      StatisticsFunc.PercentEmpty,
      StatisticsFunc.PercentFilled,
    ];
    return statisticSet;
  }

  switch (cellValueType) {
    case CellValueType.String: {
      statisticSet = [
        StatisticsFunc.Empty,
        StatisticsFunc.Filled,
        StatisticsFunc.Unique,
        StatisticsFunc.PercentEmpty,
        StatisticsFunc.PercentFilled,
        StatisticsFunc.PercentUnique,
      ];
      break;
    }
    case CellValueType.Number: {
      statisticSet = [
        StatisticsFunc.Sum,
        StatisticsFunc.Average,
        StatisticsFunc.Min,
        StatisticsFunc.Max,
        StatisticsFunc.Empty,
        StatisticsFunc.Filled,
        StatisticsFunc.Unique,
        StatisticsFunc.PercentEmpty,
        StatisticsFunc.PercentFilled,
        StatisticsFunc.PercentUnique,
      ];
      break;
    }
    case CellValueType.DateTime: {
      statisticSet = [
        StatisticsFunc.Empty,
        StatisticsFunc.Filled,
        StatisticsFunc.Unique,
        StatisticsFunc.PercentEmpty,
        StatisticsFunc.PercentFilled,
        StatisticsFunc.PercentUnique,
        StatisticsFunc.EarliestDate,
        StatisticsFunc.LatestDate,
        StatisticsFunc.DateRangeOfDays,
        StatisticsFunc.DateRangeOfMonths,
      ];
      break;
    }
    case CellValueType.Boolean: {
      statisticSet = [
        StatisticsFunc.Checked,
        StatisticsFunc.UnChecked,
        StatisticsFunc.PercentChecked,
        StatisticsFunc.PercentUnChecked,
      ];
      break;
    }
  }

  if (type === FieldType.Attachment) {
    pullAll(statisticSet, [StatisticsFunc.Unique, StatisticsFunc.PercentUnique]);
    statisticSet.push(StatisticsFunc.TotalAttachmentSize);
  }
  return statisticSet;
};
