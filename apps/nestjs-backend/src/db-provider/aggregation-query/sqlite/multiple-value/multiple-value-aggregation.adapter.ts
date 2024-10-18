import { AggregationFunctionSqlite } from '../aggregation-function.sqlite';

export class MultipleValueAggregationAdapter extends AggregationFunctionSqlite {
  unique(): string {
    return `SELECT COUNT(DISTINCT json_each.value) as value FROM ${this.dbTableName}, json_each(${this.tableColumnRef})`;
  }

  max(): string {
    return `SELECT MAX(json_each.value) as value FROM ${this.dbTableName}, json_each(${this.tableColumnRef})`;
  }

  min(): string {
    return `SELECT MIN(json_each.value) as value FROM ${this.dbTableName}, json_each(${this.tableColumnRef})`;
  }

  sum(): string {
    return `SELECT SUM(json_each.value) as value FROM ${this.dbTableName}, json_each(${this.tableColumnRef})`;
  }

  average(): string {
    return `SELECT AVG(json_each.value) as value FROM ${this.dbTableName}, json_each(${this.tableColumnRef})`;
  }

  percentUnique(): string {
    return `SELECT (COUNT(DISTINCT json_each.value) * 1.0 / MAX(COUNT(*), 1)) * 100 AS value FROM ${this.dbTableName}, json_each(${this.tableColumnRef})`;
  }

  dateRangeOfDays(): string {
    return `SELECT CAST(julianday(MAX(json_each.value)) - julianday(MIN(json_each.value)) AS INTEGER) AS value FROM ${this.dbTableName}, json_each(${this.tableColumnRef})`;
  }

  dateRangeOfMonths(): string {
    return `SELECT MAX(json_each.value) || ',' || MIN(json_each.value) AS value FROM ${this.dbTableName}, json_each(${this.tableColumnRef})`;
  }
}
