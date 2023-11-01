import { AbstractAggregationFunction } from './aggregation-function.abstract';

export class AggregationFunctionSqlite extends AbstractAggregationFunction {
  multipleCellValueUnique(): string {
    return `SELECT COUNT(DISTINCT json_each.value) as value FROM ${this.dbTableName}, json_each(${this.dbColumnName})`;
  }

  multipleCellValueMax(): string {
    return `SELECT MAX(json_each.value) as value FROM ${this.dbTableName}, json_each(${this.dbColumnName})`;
  }

  multipleCellValueMin(): string {
    return `SELECT MIN(json_each.value) as value FROM ${this.dbTableName}, json_each(${this.dbColumnName})`;
  }

  multipleCellValueSum(): string {
    return `SELECT SUM(json_each.value) as value FROM ${this.dbTableName}, json_each(${this.dbColumnName})`;
  }

  multipleCellValueAverage(): string {
    return `SELECT AVG(json_each.value) as value FROM ${this.dbTableName}, json_each(${this.dbColumnName})`;
  }

  multipleCellValuePercentUnique(): string {
    return `SELECT (COUNT(DISTINCT json_each.value) * 1.0 / COUNT(*)) * 100 AS value FROM ${this.dbTableName}, json_each(${this.dbColumnName})`;
  }

  singleCellValueDateRangeOfDays(): string {
    return `CAST(julianday(MAX(${this.dbColumnName})) - julianday(MIN(${this.dbColumnName})) as INTEGER)`;
  }

  multipleCellValueDateRangeOfDays(): string {
    return `SELECT CAST(julianday(MAX(json_each.value)) - julianday(MIN(json_each.value)) AS INTEGER) AS value FROM ${this.dbTableName}, json_each(${this.dbColumnName})`;
  }

  singleCellValueDateRangeOfMonths(): string {
    return `max(${this.dbColumnName}}) || ',' || min(${this.dbColumnName}})`;
  }

  multipleCellValueDateRangeOfMonths(): string {
    return `SELECT MAX(json_each.value) || ',' || MIN(json_each.value) AS value FROM ${this.dbTableName}, json_each(${this.dbColumnName})`;
  }

  totalAttachmentSize(): string {
    return `SELECT SUM(json_extract(json_each.value, '$.size')) AS value FROM ${this.dbTableName}, json_each(${this.dbColumnName})`;
  }
}
