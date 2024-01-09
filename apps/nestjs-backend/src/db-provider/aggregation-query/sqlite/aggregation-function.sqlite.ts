import { NotImplementedException } from '@nestjs/common';
import { AbstractAggregationFunction } from '../aggregation-function.abstract';

export class AggregationFunctionSqlite extends AbstractAggregationFunction {
  dateRangeOfDays(): string {
    throw new NotImplementedException();
  }

  dateRangeOfMonths(): string {
    throw new NotImplementedException();
  }

  totalAttachmentSize(): string {
    return `SELECT SUM(json_extract(json_each.value, '$.size')) AS value FROM ${this.dbTableName}, json_each(${this.tableColumnRef})`;
  }
}
