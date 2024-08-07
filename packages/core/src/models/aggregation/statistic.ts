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
      StatisticsFunc.Empty,
      StatisticsFunc.Filled,
      StatisticsFunc.PercentEmpty,
      StatisticsFunc.PercentFilled,
    ];
    return statisticSet;
  }

  if ([FieldType.User, FieldType.CreatedBy, FieldType.LastModifiedBy].includes(type)) {
    statisticSet = [
      StatisticsFunc.Empty,
      StatisticsFunc.Filled,
      StatisticsFunc.PercentEmpty,
      StatisticsFunc.PercentFilled,
    ];
    if (!isMultipleCellValue) {
      statisticSet.splice(2, 0, StatisticsFunc.Unique);
      statisticSet.push(StatisticsFunc.PercentUnique);
    }
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
