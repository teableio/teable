import type { IGridColumnMeta } from '@teable/core';
import { CellValueType, StatisticsFunc } from '@teable/core';
import type { IFieldInstance } from '../model';

// Group a view's column statistic funcs into the aggregation query's field-map
// shape ({ [func]: fieldIds }). When visibleFieldIds is given, hidden columns
// are dropped: share views must not request aggregates for fields the visitor
// cannot see, and personal views project only their visible fields.
export const buildStatisticFieldMap = (
  columnMeta: IGridColumnMeta | undefined,
  visibleFieldIds?: string[]
): Record<StatisticsFunc, string[]> => {
  const fieldMap = {} as Record<StatisticsFunc, string[]>;
  if (!columnMeta) return fieldMap;
  const visibleSet = visibleFieldIds ? new Set(visibleFieldIds) : undefined;
  for (const [fieldId, { statisticFunc }] of Object.entries(columnMeta)) {
    if (!statisticFunc || (visibleSet && !visibleSet.has(fieldId))) continue;
    (fieldMap[statisticFunc] ??= []).push(fieldId);
  }
  return fieldMap;
};

export const percentFormatting = (value: number) => {
  if (value % 1 === 0) {
    return value;
  }
  const pow = 100;
  return (Math.floor(value * pow) / pow).toString();
};

export const bytesToMB = (bytes: number) => {
  const mb = bytes / 1048576;
  return (mb <= 1 ? 0 : mb.toFixed(2)).toString();
};

export const statisticsValue2DisplayValue = (
  statFunc: StatisticsFunc,
  value: string | number | null,
  field: IFieldInstance
): string | null => {
  const { cellValueType } = field;

  switch (statFunc) {
    case StatisticsFunc.Count:
    case StatisticsFunc.Empty:
    case StatisticsFunc.Filled:
    case StatisticsFunc.Unique:
    case StatisticsFunc.Checked:
    case StatisticsFunc.UnChecked:
    case StatisticsFunc.DateRangeOfDays:
    case StatisticsFunc.DateRangeOfMonths: {
      return String(defaultToZero(value, statFunc));
    }
    case StatisticsFunc.Max:
    case StatisticsFunc.Min:
    case StatisticsFunc.Sum:
    case StatisticsFunc.Average:
    case StatisticsFunc.LatestDate:
    case StatisticsFunc.EarliestDate: {
      if ([CellValueType.Number, CellValueType.DateTime].includes(cellValueType)) {
        return field.item2String(defaultToZero(value, statFunc));
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
    case StatisticsFunc.TotalAttachmentSize: {
      return `${bytesToMB(value as number)}MB`;
    }
  }
};

const defaultToZero = (value: unknown, statFunc: StatisticsFunc) => {
  const defaultToZero = [
    StatisticsFunc.DateRangeOfDays,
    StatisticsFunc.DateRangeOfMonths,
    StatisticsFunc.Sum,
  ];
  if (defaultToZero.includes(statFunc) && !value) {
    return 0;
  }

  return value;
};
