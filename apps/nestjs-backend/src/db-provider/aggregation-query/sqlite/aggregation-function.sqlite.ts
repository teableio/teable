import { NotImplementedException } from '@nestjs/common';
import { FieldType } from '@teable-group/core';
import { AbstractAggregationFunction } from '../aggregation-function.abstract';

export class AggregationFunctionSqlite extends AbstractAggregationFunction {
  unique(): string {
    const { type, isMultipleCellValue } = this.field;
    if (type !== FieldType.User || isMultipleCellValue) {
      return super.unique();
    }

    return this.knex
      .raw(`COUNT(DISTINCT json_extract(??, '$.id'))`, [this.tableColumnRef])
      .toQuery();
  }

  percentUnique(): string {
    const { type, isMultipleCellValue } = this.field;
    if (type !== FieldType.User || isMultipleCellValue) {
      return super.percentUnique();
    }

    return this.knex
      .raw(`(COUNT(DISTINCT json_extract(??, '$.id')) * 1.0 / COUNT(*)) * 100`, [
        this.tableColumnRef,
      ])
      .toQuery();
  }
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
