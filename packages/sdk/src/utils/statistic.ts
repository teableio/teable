import { CellValueType, StatisticsFunc } from '@teable-group/core';
import type { IFieldInstance } from '../model';

export const percentFormatting = (value: number) => {
  if (value % 1 === 0) {
    return value;
  }
  const pow = 100;
  return (Math.floor(value * pow) / pow).toString();
};

export const statisticsValue2DisplayValue = (
  statFunc: StatisticsFunc,
  value: string | number | null,
  field: IFieldInstance
): string | null => {
  if (value == null) return null;

  const { cellValueType } = field;

  switch (statFunc) {
    case StatisticsFunc.Empty:
    case StatisticsFunc.Filled:
    case StatisticsFunc.Unique:
    case StatisticsFunc.Checked:
    case StatisticsFunc.UnChecked:
    case StatisticsFunc.DateRangeOfDays:
    case StatisticsFunc.DateRangeOfMonths: {
      return String(value);
    }
    case StatisticsFunc.Max:
    case StatisticsFunc.Min:
    case StatisticsFunc.Sum:
    case StatisticsFunc.Average:
    case StatisticsFunc.LatestDate:
    case StatisticsFunc.EarliestDate: {
      if ([CellValueType.Number, CellValueType.DateTime].includes(cellValueType)) {
        return field.cellValue2String(value);
      }
      return String(value);
    }
    case StatisticsFunc.PercentEmpty:
    case StatisticsFunc.PercentFilled:
    case StatisticsFunc.PercentUnique:
    case StatisticsFunc.PercentChecked:
    case StatisticsFunc.PercentUnChecked: {
      return `${percentFormatting(value as number)}%`;
    }
  }
};
