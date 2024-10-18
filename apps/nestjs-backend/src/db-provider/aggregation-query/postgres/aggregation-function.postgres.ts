import { NotImplementedException } from '@nestjs/common';
import { FieldType } from '@teable/core';
import { AbstractAggregationFunction } from '../aggregation-function.abstract';

export class AggregationFunctionPostgres extends AbstractAggregationFunction {
  unique(): string {
    const { type, isMultipleCellValue } = this.field;
    if (
      ![FieldType.User, FieldType.CreatedBy, FieldType.LastModifiedBy].includes(type) ||
      isMultipleCellValue
    ) {
      return super.unique();
    }

    return this.knex.raw(`COUNT(DISTINCT ?? ->> 'id')`, [this.tableColumnRef]).toQuery();
  }

  percentUnique(): string {
    const { type, isMultipleCellValue } = this.field;
    if (
      ![FieldType.User, FieldType.CreatedBy, FieldType.LastModifiedBy].includes(type) ||
      isMultipleCellValue
    ) {
      return this.knex
        .raw(`(COUNT(DISTINCT ??) * 1.0 / GREATEST(COUNT(*), 1)) * 100`, [this.tableColumnRef])
        .toQuery();
    }

    return this.knex
      .raw(`(COUNT(DISTINCT ?? ->> 'id') * 1.0 / GREATEST(COUNT(*), 1)) * 100`, [
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
    return this.knex
      .raw(
        `SELECT SUM(("value"::json ->> 'size')::INTEGER) AS "value" FROM ??, jsonb_array_elements(??)`,
        [this.dbTableName, this.tableColumnRef]
      )
      .toQuery();
  }

  percentEmpty(): string {
    return this.knex
      .raw(`((COUNT(*) - COUNT(??)) * 1.0 / GREATEST(COUNT(*), 1)) * 100`, [this.tableColumnRef])
      .toQuery();
  }

  percentFilled(): string {
    return this.knex
      .raw(`(COUNT(??) * 1.0 / GREATEST(COUNT(*), 1)) * 100`, [this.tableColumnRef])
      .toQuery();
  }

  percentChecked(): string {
    return this.percentFilled();
  }

  percentUnChecked(): string {
    return this.percentEmpty();
  }
}
