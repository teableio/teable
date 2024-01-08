import { NotImplementedException } from '@nestjs/common';
import { AbstractAggregationFunction } from '../aggregation-function.abstract';

export class AggregationFunctionPostgres extends AbstractAggregationFunction {
  dateRangeOfDays(): string {
    throw new NotImplementedException();
  }

  dateRangeOfMonths(): string {
    throw new NotImplementedException();
  }

  totalAttachmentSize(): string {
    return this.knex
      .raw(
        `SELECT SUM(("value"::json ->> 'size')::INTEGER) AS "value" FROM ??, json_array_elements(??)`,
        [this.dbTableName, this.tableColumnRef]
      )
      .toQuery();
  }
}
