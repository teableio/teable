import { NotImplementedException } from '@nestjs/common';
import { FieldType } from '@teable/core';
import { AbstractAggregationFunction } from '../aggregation-function.abstract';

export class AggregationFunctionSqlite extends AbstractAggregationFunction {
  unique(): string {
    const { type, isMultipleCellValue } = this.field;
    if (
      ![FieldType.User, FieldType.CreatedBy, FieldType.LastModifiedBy].includes(type) ||
      isMultipleCellValue
    ) {
      return super.unique();
    }

    return this.knex
      .raw(`COUNT(DISTINCT json_extract(??, '$.id'))`, [this.tableColumnRef])
      .toQuery();
  }

  percentUnique(): string {
    const { type, isMultipleCellValue } = this.field;
    if (
      ![FieldType.User, FieldType.CreatedBy, FieldType.LastModifiedBy].includes(type) ||
      isMultipleCellValue
    ) {
      return this.knex
        .raw(`(COUNT(DISTINCT ??) * 1.0 / MAX(COUNT(*), 1)) * 100`, [this.tableColumnRef])
        .toQuery();
    }

    return this.knex
      .raw(`(COUNT(DISTINCT json_extract(??, '$.id')) * 1.0 / MAX(COUNT(*), 1)) * 100`, [
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

  percentEmpty(): string {
    return this.knex
      .raw(`((COUNT(*) - COUNT(??)) * 1.0 / MAX(COUNT(*), 1)) * 100`, [this.tableColumnRef])
      .toQuery();
  }

  percentFilled(): string {
    return this.knex
      .raw(`(COUNT(??) * 1.0 / MAX(COUNT(*), 1)) * 100`, [this.tableColumnRef])
      .toQuery();
  }

  percentChecked(): string {
    return this.percentFilled();
  }

  percentUnChecked(): string {
    return this.percentEmpty();
  }
}
