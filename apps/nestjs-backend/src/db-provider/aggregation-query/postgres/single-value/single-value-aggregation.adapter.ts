import { AggregationFunctionPostgres } from '../aggregation-function.postgres';

export class SingleValueAggregationAdapter extends AggregationFunctionPostgres {
  dateRangeOfDays(): string {
    return this.knex
      .raw(`extract(DAY FROM (MAX(${this.tableColumnRef}) - MIN(${this.tableColumnRef})))::INTEGER`)
      .toQuery();
  }

  dateRangeOfMonths(): string {
    return this.knex
      .raw(`CONCAT(MAX(${this.tableColumnRef}), ',', MIN(${this.tableColumnRef}))`)
      .toQuery();
  }
}
