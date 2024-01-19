import { NotImplementedException } from '@nestjs/common';
import { FieldType } from '@teable-group/core';
import { AbstractAggregationFunction } from '../aggregation-function.abstract';

export class AggregationFunctionPostgres extends AbstractAggregationFunction {
  unique(): string {
    const { type, isMultipleCellValue } = this.field;
    if (type !== FieldType.User || isMultipleCellValue) {
      return super.unique();
    }

    return this.knex.raw(`COUNT(DISTINCT ?? ->> 'id')`, [this.tableColumnRef]).toQuery();
  }

  percentUnique(): string {
    const { type, isMultipleCellValue } = this.field;
    if (type !== FieldType.User || isMultipleCellValue) {
      return super.percentUnique();
    }

    return this.knex
      .raw(`(COUNT(DISTINCT ?? ->> 'id') * 1.0 / COUNT(*)) * 100`, [this.tableColumnRef])
      .toQuery();
  }

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
