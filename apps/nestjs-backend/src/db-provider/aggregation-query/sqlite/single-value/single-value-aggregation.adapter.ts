import { AggregationFunctionSqlite } from '../aggregation-function.sqlite';

export class SingleValueAggregationAdapter extends AggregationFunctionSqlite {
  dateRangeOfDays(): string {
    return `CAST(julianday(MAX(${this.tableColumnRef})) - julianday(MIN(${this.tableColumnRef})) as INTEGER)`;
  }

  dateRangeOfMonths(): string {
    return `MAX(${this.tableColumnRef}) || ',' || MIN(${this.tableColumnRef})`;
  }
}
