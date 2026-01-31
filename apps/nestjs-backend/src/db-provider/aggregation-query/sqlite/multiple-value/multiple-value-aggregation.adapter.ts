import { AggregationFunctionSqlite } from '../aggregation-function.sqlite';

export class MultipleValueAggregationAdapter extends AggregationFunctionSqlite {
  unique(): string {
    return this.knex
      .raw(
        `SELECT COUNT(DISTINCT json_each.value) as value FROM ?? as "${this.tableAlias}", json_each(${this.tableColumnRef})`,
        [this.dbTableName]
      )
      .toQuery();
  }

  max(): string {
    return this.knex
      .raw(
        `SELECT MAX(json_each.value) as value FROM ?? as "${this.tableAlias}", json_each(${this.tableColumnRef})`,
        [this.dbTableName]
      )
      .toQuery();
  }

  min(): string {
    return this.knex
      .raw(
        `SELECT MIN(json_each.value) as value FROM ?? as "${this.tableAlias}", json_each(${this.tableColumnRef})`,
        [this.dbTableName]
      )
      .toQuery();
  }

  sum(): string {
    return this.knex
      .raw(
        `SELECT SUM(json_each.value) as value FROM ?? as "${this.tableAlias}", json_each(${this.tableColumnRef})`,
        [this.dbTableName]
      )
      .toQuery();
  }

  average(): string {
    return this.knex
      .raw(
        `SELECT AVG(json_each.value) as value FROM ?? as "${this.tableAlias}", json_each(${this.tableColumnRef})`,
        [this.dbTableName]
      )
      .toQuery();
  }

  percentUnique(): string {
    return this.knex
      .raw(
        `SELECT (COUNT(DISTINCT json_each.value) * 1.0 / MAX(COUNT(*), 1)) * 100 AS value FROM ?? as "${this.tableAlias}", json_each(${this.tableColumnRef})`,
        [this.dbTableName]
      )
      .toQuery();
  }

  dateRangeOfDays(): string {
    return this.knex
      .raw(
        `SELECT CAST(julianday(MAX(json_each.value)) - julianday(MIN(json_each.value)) AS INTEGER) AS value FROM ?? as "${this.tableAlias}", json_each(${this.tableColumnRef})`,
        [this.dbTableName]
      )
      .toQuery();
  }

  dateRangeOfMonths(): string {
    return this.knex
      .raw(
        `SELECT MAX(json_each.value) || ',' || MIN(json_each.value) AS value FROM ?? as "${this.tableAlias}", json_each(${this.tableColumnRef})`,
        [this.dbTableName]
      )
      .toQuery();
  }

  checked(): string {
    return this.knex
      .raw(
        `SUM(CASE WHEN EXISTS (SELECT 1 FROM json_each(${this.tableColumnRef}) WHERE json_each.value = 1) THEN 1 ELSE 0 END)`
      )
      .toQuery();
  }

  unChecked(): string {
    return this.knex
      .raw(
        `SUM(CASE WHEN ${this.tableColumnRef} IS NULL OR NOT EXISTS (SELECT 1 FROM json_each(${this.tableColumnRef}) WHERE json_each.value = 1) THEN 1 ELSE 0 END)`
      )
      .toQuery();
  }

  percentChecked(): string {
    return this.knex
      .raw(
        `(SUM(CASE WHEN EXISTS (SELECT 1 FROM json_each(${this.tableColumnRef}) WHERE json_each.value = 1) THEN 1 ELSE 0 END) * 1.0 / MAX(COUNT(*), 1)) * 100`
      )
      .toQuery();
  }

  percentUnChecked(): string {
    return this.knex
      .raw(
        `(SUM(CASE WHEN ${this.tableColumnRef} IS NULL OR NOT EXISTS (SELECT 1 FROM json_each(${this.tableColumnRef}) WHERE json_each.value = 1) THEN 1 ELSE 0 END) * 1.0 / MAX(COUNT(*), 1)) * 100`
      )
      .toQuery();
  }
}
