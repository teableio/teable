import { AggregationFunctionPostgres } from '../aggregation-function.postgres';

export class MultipleValueAggregationAdapter extends AggregationFunctionPostgres {
  unique(): string {
    return this.knex
      .raw(
        `SELECT COUNT(DISTINCT "value") AS "value" FROM ??, jsonb_array_elements_text(??::jsonb)`,
        [this.dbTableName, this.tableColumnRef]
      )
      .toQuery();
  }

  max(): string {
    return this.knex
      .raw(
        `SELECT MAX("value"::INTEGER) AS "value" FROM ??, jsonb_array_elements_text(??::jsonb)`,
        [this.dbTableName, this.tableColumnRef]
      )
      .toQuery();
  }

  min(): string {
    return this.knex
      .raw(
        `SELECT MIN("value"::INTEGER) AS "value" FROM ??, jsonb_array_elements_text(??::jsonb)`,
        [this.dbTableName, this.tableColumnRef]
      )
      .toQuery();
  }

  sum(): string {
    return this.knex
      .raw(
        `SELECT SUM("value"::INTEGER) AS "value" FROM ??, jsonb_array_elements_text(??::jsonb)`,
        [this.dbTableName, this.tableColumnRef]
      )
      .toQuery();
  }

  average(): string {
    return this.knex
      .raw(
        `SELECT AVG("value"::INTEGER) AS "value" FROM ??, jsonb_array_elements_text(??::jsonb)`,
        [this.dbTableName, this.tableColumnRef]
      )
      .toQuery();
  }

  percentUnique(): string {
    return this.knex
      .raw(
        `SELECT (COUNT(DISTINCT "value") * 1.0 / GREATEST(COUNT(*), 1)) * 100 AS "value" FROM ??, jsonb_array_elements_text(??::jsonb)`,
        [this.dbTableName, this.tableColumnRef]
      )
      .toQuery();
  }

  dateRangeOfDays(): string {
    return this.knex
      .raw(
        `SELECT extract(DAY FROM (MAX("value"::TIMESTAMPTZ) - MIN("value"::TIMESTAMPTZ)))::INTEGER AS "value" FROM ??, jsonb_array_elements_text(??::jsonb)`,
        [this.dbTableName, this.tableColumnRef]
      )
      .toQuery();
  }

  dateRangeOfMonths(): string {
    return this.knex
      .raw(
        `SELECT CONCAT(MAX("value"::TIMESTAMPTZ), ',', MIN("value"::TIMESTAMPTZ)) AS "value" FROM ??, jsonb_array_elements_text(??::jsonb)`,
        [this.dbTableName, this.tableColumnRef]
      )
      .toQuery();
  }
}
