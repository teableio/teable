import { AggregationFunctionSqlite } from '../aggregation-function.sqlite';

export class SingleValueAggregationAdapter extends AggregationFunctionSqlite {
  dateRangeOfDays(): string {
    return `CAST(julianday(MAX(${this.tableColumnRef})) - julianday(MIN(${this.tableColumnRef})) as INTEGER)`;
  }

  dateRangeOfMonths(): string {
    return `max(${this.tableColumnRef}}) || ',' || min(${this.tableColumnRef}})`;
  }
}
