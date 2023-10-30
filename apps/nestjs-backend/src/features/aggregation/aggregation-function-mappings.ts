import { StatisticsFunc } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../db-provider/interface/db.provider.interface';
import type { IFieldInstance } from '../field/model/factory';

// eslint-disable-next-line sonarjs/cognitive-complexity
export function getSimpleAggRawSql(
  knex: Knex,
  dbTableName: string,
  field: IFieldInstance,
  func: StatisticsFunc
) {
  const { dbFieldName, isMultipleCellValue } = field;

  const dbColumnName = `${dbTableName}.${dbFieldName}`;

  switch (func) {
    case StatisticsFunc.Empty:
    case StatisticsFunc.UnChecked: {
      return knex.raw(`count(*) - count(??)`, [dbColumnName]);
    }
    case StatisticsFunc.Filled:
    case StatisticsFunc.Checked: {
      return knex.raw(`count(??)`, [dbColumnName]);
    }
    case StatisticsFunc.Unique: {
      if (isMultipleCellValue) {
        // return `select count(distinct json_each.value) as value from ${dbTableName}, json_each(${dbTableName}.${dbFieldName})`;
        return knex.raw(`select count(distinct json_each.value) as value from ??, json_each(??)`, [
          dbTableName,
          dbColumnName,
        ]);
      }
      return knex.raw(`count(distinct ??)`, [dbColumnName]);
    }
    case StatisticsFunc.Max:
    case StatisticsFunc.LatestDate: {
      if (isMultipleCellValue) {
        return `select max(json_each.value) as value from ${dbTableName}, json_each(${dbTableName}.${dbFieldName})`;
      }
      return knex.raw(`max(??)`, [dbColumnName]);
    }
    case StatisticsFunc.Min:
    case StatisticsFunc.EarliestDate: {
      if (isMultipleCellValue) {
        return `select min(json_each.value) as value from ${dbTableName}, json_each(${dbTableName}.${dbFieldName})`;
      }
      return knex.raw(`min(??)`, [dbColumnName]);
    }
    case StatisticsFunc.Sum: {
      if (isMultipleCellValue) {
        return `select sum(json_each.value) as value from ${dbTableName}, json_each(${dbTableName}.${dbFieldName})`;
      }
      return knex.raw(`sum(??)`, [dbColumnName]);
    }
    case StatisticsFunc.Average: {
      if (isMultipleCellValue) {
        return `select avg(json_each.value) as value from ${dbTableName}, json_each(${dbTableName}.${dbFieldName})`;
      }
      return knex.raw(`avg(??)`, [dbColumnName]);
    }
    case StatisticsFunc.PercentEmpty:
    case StatisticsFunc.PercentUnChecked: {
      return knex.raw(`((count(*) - count(??)) * 1.0 / count(*)) * 100`, [dbColumnName]);
    }
    case StatisticsFunc.PercentFilled:
    case StatisticsFunc.PercentChecked: {
      return knex.raw(`(count(??) * 1.0 / count(*)) * 100`, [dbColumnName]);
    }
    case StatisticsFunc.PercentUnique: {
      if (isMultipleCellValue) {
        return `select (count(distinct json_each.value) * 1.0 / count(*)) * 100 as value from ${dbTableName}, json_each(${dbTableName}.${dbFieldName})`;
      }
      return knex.raw(`(count(distinct ??) * 1.0 / count(*)) * 100`, [dbColumnName]);
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
      return knex.raw(`max(??) || ',' || min(??)`, [dbColumnName, dbColumnName]);
    }
    case StatisticsFunc.TotalAttachmentSize: {
      return `select sum(json_extract(json_each.value, '$.size')) as value from ${dbTableName}, json_each(${dbTableName}.${dbFieldName})`;
    }
  }
}

export function getAggregationFunctionMapping(
  dbProvider: IDbProvider,
  dbTableName: string,
  field: IFieldInstance,
  func: StatisticsFunc
): string {
  const funcName = func.toString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (dbProvider.aggregationFunction(dbTableName, field) as any)[funcName]?.();
}
