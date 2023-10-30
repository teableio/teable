import type { Knex } from 'knex';
import type { IFieldInstance } from '../../features/field/model/factory';
import type { IAggregationFunctionInterface } from './aggregation-function.interface';

export abstract class AbstractAggregationFunction implements IAggregationFunctionInterface {
  protected dbColumnName: string;

  protected isMultipleCellValue?: boolean;
  constructor(
    protected readonly knex: Knex,
    protected readonly dbTableName: string,
    protected readonly field: IFieldInstance
  ) {
    const { dbFieldName, isMultipleCellValue } = this.field;

    this.dbColumnName = `${this.dbTableName}.${dbFieldName}`;
    this.isMultipleCellValue = isMultipleCellValue;
  }

  empty(): string {
    return this.knex.raw(`COUNT(*) - COUNT(??)`, [this.dbColumnName]).toQuery();
  }

  filled(): string {
    return this.knex.raw(`COUNT(??)`, [this.dbColumnName]).toQuery();
  }

  unique(): string {
    if (this.isMultipleCellValue) {
      return this.multipleCellValueUnique();
    }
    return this.knex.raw(`COUNT(DISTINCT ??)`, [this.dbColumnName]).toQuery();
  }

  max(): string {
    if (this.isMultipleCellValue) {
      return this.multipleCellValueMax();
    }
    return this.knex.raw(`MAX(??)`, [this.dbColumnName]).toQuery();
  }

  min(): string {
    if (this.isMultipleCellValue) {
      return this.multipleCellValueMin();
    }
    return this.knex.raw(`MIN(??)`, [this.dbColumnName]).toQuery();
  }

  sum(): string {
    if (this.isMultipleCellValue) {
      return this.multipleCellValueSum();
    }
    return this.knex.raw(`SUM(??)`, [this.dbColumnName]).toQuery();
  }

  average(): string {
    if (this.isMultipleCellValue) {
      return this.multipleCellValueAverage();
    }
    return this.knex.raw(`AVG(??)`, [this.dbColumnName]).toQuery();
  }

  checked(): string {
    return this.filled();
  }

  unChecked(): string {
    return this.empty();
  }

  percentEmpty(): string {
    return this.knex
      .raw(`((COUNT(*) - COUNT(??)) * 1.0 / COUNT(*)) * 100`, [this.dbColumnName])
      .toQuery();
  }

  percentFilled(): string {
    return this.knex.raw(`(COUNT(??) * 1.0 / COUNT(*)) * 100`, [this.dbColumnName]).toQuery();
  }

  percentUnique(): string {
    if (this.isMultipleCellValue) {
      return this.multipleCellValuePercentUnique();
    }
    return this.knex
      .raw(`(COUNT(DISTINCT ??) * 1.0 / COUNT(*)) * 100`, [this.dbColumnName])
      .toQuery();
  }

  percentChecked(): string {
    return this.percentFilled();
  }

  percentUnChecked(): string {
    return this.percentEmpty();
  }

  earliestDate(): string {
    return this.min();
  }

  latestDate(): string {
    return this.max();
  }

  dateRangeOfDays(): string {
    return this.isMultipleCellValue
      ? this.multipleCellValueDateRangeOfDays()
      : this.singleCellValueDateRangeOfDays();
  }

  dateRangeOfMonths(): string {
    return this.isMultipleCellValue
      ? this.multipleCellValueDateRangeOfMonths()
      : this.singleCellValueDateRangeOfMonths();
  }

  abstract totalAttachmentSize(): string;

  abstract multipleCellValueUnique(): string;

  abstract multipleCellValueMax(): string;

  abstract multipleCellValueMin(): string;

  abstract multipleCellValueSum(): string;

  abstract multipleCellValueAverage(): string;

  abstract multipleCellValuePercentUnique(): string;

  abstract singleCellValueDateRangeOfDays(): string;

  abstract multipleCellValueDateRangeOfDays(): string;

  abstract singleCellValueDateRangeOfMonths(): string;

  abstract multipleCellValueDateRangeOfMonths(): string;
}
