import { pullAll } from 'lodash';
import { CellValueType, FieldType } from '../field';
import { StatisticsFunc } from './statistics-func.enum';

export const getValidStatisticFunc = (field?: {
  type: FieldType;
  cellValueType: CellValueType;
  isMultipleCellValue?: boolean;
}): StatisticsFunc[] => {
  let statisticSet: StatisticsFunc[] = [];
  if (!field) {
    return statisticSet;
  }

  const { type, cellValueType, isMultipleCellValue } = field;

  if (type === FieldType.Link) {
    statisticSet = [
      StatisticsFunc.Count,
      StatisticsFunc.Empty,
      StatisticsFunc.Filled,
      StatisticsFunc.PercentEmpty,
      StatisticsFunc.PercentFilled,
    ];
    return statisticSet;
  }

  if ([FieldType.User, FieldType.CreatedBy, FieldType.LastModifiedBy].includes(type)) {
    statisticSet = [
      StatisticsFunc.Count,
      StatisticsFunc.Empty,
      StatisticsFunc.Filled,
      StatisticsFunc.PercentEmpty,
      StatisticsFunc.PercentFilled,
    ];
    if (!isMultipleCellValue) {
      statisticSet.splice(3, 0, StatisticsFunc.Unique);
      statisticSet.push(StatisticsFunc.PercentUnique);
    }
    return statisticSet;
  }

  switch (cellValueType) {
    case CellValueType.String: {
      statisticSet = [
        StatisticsFunc.Count,
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
        StatisticsFunc.Count,
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
        StatisticsFunc.Count,
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
        StatisticsFunc.Count,
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
