import { z } from 'zod';
import type { DbFieldType, FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';

export class NumberFieldOptions {
  precision!: number;
}

export class NumberFieldCore extends FieldCore {
  type!: FieldType.Number;

  dbFieldType!: DbFieldType.Real;

  options!: NumberFieldOptions;

  defaultValue: number | null = null;

  calculatedType!: FieldType.Number;

  cellValueType!: CellValueType.Number;

  isComputed!: false;

  static defaultOptions(): NumberFieldOptions {
    return {
      precision: 0,
    };
  }

  cellValue2String(cellValue: number) {
    if (cellValue == null) {
      return '';
    }
    const precision = this.options?.precision || 0;
    return cellValue.toFixed(precision);
  }

  convertStringToCellValue(value: string): number | null {
    const num = Number(value);
    if (Number.isNaN(num)) {
      return null;
    }
    return num;
  }

  repair(value: unknown) {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      return this.convertStringToCellValue(value);
    }
    throw new Error(`invalid value: ${value} for field: ${this.name}`);
  }

  validateOptions() {
    return z
      .object({
        precision: z.number().max(5).min(0),
      })
      .optional()
      .safeParse(this.options);
  }

  validateDefaultValue() {
    return z.number().optional().nullable().safeParse(this.defaultValue);
  }
}
