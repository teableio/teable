import { AbstractAggregationFunction } from './aggregation-function.abstract';

export class AggregationFunctionPostgres extends AbstractAggregationFunction {
  multipleCellValueUnique(): string {
    return this.knex
      .raw(`SELECT COUNT(DISTINCT "value") AS "value" FROM ??, json_array_elements_text(??)`, [
        this.dbTableName,
        this.dbColumnName,
      ])
      .toQuery();
  }

  multipleCellValueMax(): string {
    return this.knex
      .raw(`SELECT MAX("value"::INTEGER) AS "value" FROM ??, json_array_elements_text(??)`, [
        this.dbTableName,
        this.dbColumnName,
      ])
      .toQuery();
  }

  multipleCellValueMin(): string {
    return this.knex
      .raw(`SELECT MIN("value"::INTEGER) AS "value" FROM ??, json_array_elements_text(??)`, [
        this.dbTableName,
        this.dbColumnName,
      ])
      .toQuery();
  }

  multipleCellValueSum(): string {
    return this.knex
      .raw(`SELECT SUM("value"::INTEGER) AS "value" FROM ??, json_array_elements_text(??)`, [
        this.dbTableName,
        this.dbColumnName,
      ])
      .toQuery();
  }

  multipleCellValueAverage(): string {
    return this.knex
      .raw(`SELECT AVG("value"::INTEGER) AS "value" FROM ??, json_array_elements_text(??)`, [
        this.dbTableName,
        this.dbColumnName,
      ])
      .toQuery();
  }

  multipleCellValuePercentUnique(): string {
    return this.knex
      .raw(
        `SELECT (COUNT(DISTINCT "value") * 1.0 / COUNT(*)) * 100 AS "value" FROM ??, json_array_elements_text(??)`,
        [this.dbTableName, this.dbColumnName]
      )
      .toQuery();
  }

  singleCellValueDateRangeOfDays(): string {
    return this.knex
      .raw(`extract(DAY FROM (MAX(??) - MIN(??)))::INTEGER`, [this.dbColumnName, this.dbColumnName])
      .toQuery();
  }

  multipleCellValueDateRangeOfDays(): string {
    return this.knex
      .raw(
        `SELECT extract(DAY FROM (MAX("value"::TIMESTAMPTZ) - MIN("value"::TIMESTAMPTZ)))::INTEGER AS "value" FROM ??, json_array_elements_text(??)`,
        [this.dbTableName, this.dbColumnName]
      )
      .toQuery();
  }

  singleCellValueDateRangeOfMonths(): string {
    return this.knex
      .raw(`CONCAT(MAX(??), ',', MIN(??))`, [this.dbColumnName, this.dbColumnName])
      .toQuery();
  }

  multipleCellValueDateRangeOfMonths(): string {
    return this.knex
      .raw(
        `SELECT CONCAT(MAX("value"::TIMESTAMPTZ), ',', MIN("value"::TIMESTAMPTZ)) AS "value" FROM ??, json_array_elements_text(??)`,
        [this.dbTableName, this.dbColumnName]
      )
      .toQuery();
  }

  totalAttachmentSize(): string {
    return this.knex
      .raw(
        `SELECT SUM(("value"::json ->> 'size')::INTEGER) AS "value" FROM ??, json_array_elements(??)`,
        [this.dbTableName, this.dbColumnName]
      )
      .toQuery();
  }
}
