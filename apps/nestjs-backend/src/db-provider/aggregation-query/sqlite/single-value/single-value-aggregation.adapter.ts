import { AggregationFunctionSqlite } from '../aggregation-function.sqlite';

export class SingleValueAggregationAdapter extends AggregationFunctionSqlite {
  dateRangeOfDays(): string {
    return this.knex
      .raw(
        `CAST(julianday(MAX(${this.tableColumnRef})) - julianday(MIN(${this.tableColumnRef})) as INTEGER)`
      )
      .toQuery();
  }

  dateRangeOfMonths(): string {
    return this.knex
      .raw(`MAX(${this.tableColumnRef}) || ',' || MIN(${this.tableColumnRef})`)
      .toQuery();
  }
}
