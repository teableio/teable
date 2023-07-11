import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import { numberFormattingSchema } from '../formatting';

export const numberOptionsSchema = z.object({
  formatting: numberFormattingSchema,
});

export type INumberFieldOptions = z.infer<typeof numberOptionsSchema>;

export const numberCellValueSchema = z.number().nullable();

export type INumberCellValue = z.infer<typeof numberCellValueSchema>;

export class NumberFieldCore extends FieldCore {
  type!: FieldType.Number;

  options!: INumberFieldOptions;

  cellValueType!: CellValueType.Number;

  static defaultOptions(): INumberFieldOptions {
    return {
      formatting: {
        precision: 0,
      },
    };
  }

  cellValue2String(cellValue: number | number[] | undefined) {
    if (cellValue == null) {
      return '';
    }
    const precision = this.options.formatting.precision;

    if (this.isMultipleCellValue && Array.isArray(cellValue)) {
      return cellValue.map((v) => (v || 0).toFixed(precision)).join(', ');
    }

    return (cellValue as number).toFixed(precision);
  }

  convertStringToCellValue(value: string): number | null {
    if (this.isLookup) {
      return null;
    }

    const num = Number(value);
    if (Number.isNaN(num)) {
      return null;
    }
    return num;
  }

  repair(value: unknown) {
    if (this.isLookup) {
      return null;
    }

    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      return this.convertStringToCellValue(value);
    }
    throw null;
  }

  validateOptions() {
    return numberOptionsSchema.safeParse(this.options);
  }

  validateCellValue(value: unknown) {
    if (this.isMultipleCellValue) {
      return z.array(numberCellValueSchema).nonempty().optional().safeParse(value);
    }
    return numberCellValueSchema.optional().safeParse(value);
  }
}
