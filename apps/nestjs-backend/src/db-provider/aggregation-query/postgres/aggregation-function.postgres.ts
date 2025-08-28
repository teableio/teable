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

    return this.knex.raw(`COUNT(DISTINCT ${this.tableColumnRef} ->> 'id')`).toQuery();
  }

  percentUnique(): string {
    const { type, isMultipleCellValue } = this.field;
    if (
      ![FieldType.User, FieldType.CreatedBy, FieldType.LastModifiedBy].includes(type) ||
      isMultipleCellValue
    ) {
      return this.knex
        .raw(`(COUNT(DISTINCT ${this.tableColumnRef}) * 1.0 / GREATEST(COUNT(*), 1)) * 100`)
        .toQuery();
    }

    return this.knex
      .raw(`(COUNT(DISTINCT ${this.tableColumnRef} ->> 'id') * 1.0 / GREATEST(COUNT(*), 1)) * 100`)
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
        `SELECT SUM(("value"::json ->> 'size')::INTEGER) AS "value" FROM ?? as "${this.tableAlias}", jsonb_array_elements(${this.tableColumnRef})`,
        [this.dbTableName]
      )
      .toQuery();
  }

  percentEmpty(): string {
    return this.knex
      .raw(`((COUNT(*) - COUNT(${this.tableColumnRef})) * 1.0 / GREATEST(COUNT(*), 1)) * 100`)
      .toQuery();
  }

  percentFilled(): string {
    return this.knex
      .raw(`(COUNT(${this.tableColumnRef}) * 1.0 / GREATEST(COUNT(*), 1)) * 100`)
      .toQuery();
  }

  percentChecked(): string {
    return this.percentFilled();
  }

  percentUnChecked(): string {
    return this.percentEmpty();
  }
}
