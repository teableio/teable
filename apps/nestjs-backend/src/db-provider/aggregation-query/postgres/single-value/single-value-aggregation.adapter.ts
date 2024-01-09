import { AggregationFunctionPostgres } from '../aggregation-function.postgres';

export class SingleValueAggregationAdapter extends AggregationFunctionPostgres {
  dateRangeOfDays(): string {
    return this.knex
      .raw(`extract(DAY FROM (MAX(??) - MIN(??)))::INTEGER`, [
        this.tableColumnRef,
        this.tableColumnRef,
      ])
      .toQuery();
  }

  dateRangeOfMonths(): string {
    return this.knex
      .raw(`CONCAT(MAX(??), ',', MIN(??))`, [this.tableColumnRef, this.tableColumnRef])
      .toQuery();
  }
}
