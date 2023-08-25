import { StatisticsFunc } from '@teable-group/core';
import type { IFieldInstance } from '../field/model/factory';

// eslint-disable-next-line sonarjs/cognitive-complexity
export function getSimpleAggRawSql(
  dbTableName: string,
  field: IFieldInstance,
  func: StatisticsFunc
) {
  const { dbFieldName, isMultipleCellValue } = field;

  switch (func) {
    case StatisticsFunc.Empty:
    case StatisticsFunc.UnChecked: {
      return `count(*) - count(${dbTableName}.${dbFieldName})`;
    }
    case StatisticsFunc.Filled:
    case StatisticsFunc.Checked: {
      return `count(${dbTableName}.${dbFieldName})`;
    }
    case StatisticsFunc.Unique: {
      if (isMultipleCellValue) {
        return `select count(distinct json_each.value) as value from ${dbTableName}, json_each(${dbTableName}.${dbFieldName})`;
      }
      return `count(distinct ${dbTableName}.${dbFieldName})`;
    }
    case StatisticsFunc.Max:
    case StatisticsFunc.LatestDate: {
      if (isMultipleCellValue) {
        return `select max(json_each.value) as value from ${dbTableName}, json_each(${dbTableName}.${dbFieldName})`;
      }
      return `max(${dbTableName}.${dbFieldName})`;
    }
    case StatisticsFunc.Min:
    case StatisticsFunc.EarliestDate: {
      if (isMultipleCellValue) {
        return `select min(json_each.value) as value from ${dbTableName}, json_each(${dbTableName}.${dbFieldName})`;
      }
      return `min(${dbTableName}.${dbFieldName})`;
    }
    case StatisticsFunc.Sum: {
      if (isMultipleCellValue) {
        return `select sum(json_each.value) as value from ${dbTableName}, json_each(${dbTableName}.${dbFieldName})`;
      }
      return `sum(${dbTableName}.${dbFieldName})`;
    }
    case StatisticsFunc.Average: {
      if (isMultipleCellValue) {
        return `select avg(json_each.value) as value from ${dbTableName}, json_each(${dbTableName}.${dbFieldName})`;
      }
      return `avg(${dbTableName}.${dbFieldName})`;
    }
    case StatisticsFunc.PercentEmpty:
    case StatisticsFunc.PercentUnChecked: {
      return `((count(*) - count(${dbTableName}.${dbFieldName})) * 1.0 / count(*)) * 100`;
    }
    case StatisticsFunc.PercentFilled:
    case StatisticsFunc.PercentChecked: {
      return `(count(${dbTableName}.${dbFieldName}) * 1.0 / COUNT(*)) * 100`;
    }
    case StatisticsFunc.PercentUnique: {
      if (isMultipleCellValue) {
        return `select (count(distinct json_each.value) * 1.0 / count(*)) * 100 as value from ${dbTableName}, json_each(${dbTableName}.${dbFieldName})`;
      }
      return `(count(distinct ${dbTableName}.${dbFieldName}) * 1.0 / count(*)) * 100`;
    }
    case StatisticsFunc.DateRangeOfDays: {
      if (isMultipleCellValue) {
        return `select cast(julianday(max(json_each.value)) - julianday(min(json_each.value)) as INTEGER) as value from ${dbTableName}, json_each(${dbTableName}.${dbFieldName})`;
      }
      return `cast(julianday(max(${dbTableName}.${dbFieldName})) - julianday(min(${dbTableName}.${dbFieldName})) as INTEGER)`;
    }
    case StatisticsFunc.DateRangeOfMonths: {
      if (isMultipleCellValue) {
        return `select max(json_each.value) || ',' || min(json_each.value) as value from ${dbTableName}, json_each(${dbTableName}.${dbFieldName})`;
      }
      return `max(${dbTableName}.${dbFieldName}) || ',' || min(${dbTableName}.${dbFieldName})`;
    }
    case StatisticsFunc.TotalAttachmentSize: {
      return `select sum(json_extract(json_each.value, '$.size')) as value from ${dbTableName}, json_each(${dbTableName}.${dbFieldName})`;
    }
  }
}
