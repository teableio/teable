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
    // Sum sizes per row, then sum across the current scope (respects GROUP BY)
    return this.knex
      .raw(
        `SUM(COALESCE((SELECT SUM((e.value ->> 'size')::INTEGER)
          FROM jsonb_array_elements(COALESCE(${this.tableColumnRef}, '[]'::jsonb)) AS e), 0))`
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

  checked(): string {
    return this.knex
      .raw(`SUM(CASE WHEN ${this.tableColumnRef} = true THEN 1 ELSE 0 END)`)
      .toQuery();
  }

  unChecked(): string {
    return this.knex
      .raw(
        `SUM(CASE WHEN ${this.tableColumnRef} = false OR ${this.tableColumnRef} IS NULL THEN 1 ELSE 0 END)`
      )
      .toQuery();
  }

  percentChecked(): string {
    return this.knex
      .raw(
        `(SUM(CASE WHEN ${this.tableColumnRef} = true THEN 1 ELSE 0 END) * 1.0 / GREATEST(COUNT(*), 1)) * 100`
      )
      .toQuery();
  }

  percentUnChecked(): string {
    return this.knex
      .raw(
        `(SUM(CASE WHEN ${this.tableColumnRef} = false OR ${this.tableColumnRef} IS NULL THEN 1 ELSE 0 END) * 1.0 / GREATEST(COUNT(*), 1)) * 100`
      )
      .toQuery();
  }
}
