import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import {
  defaultNumberFormatting,
  formatNumberToString,
  numberFormattingSchema,
} from '../formatting';
import { getShowAsSchema, numberShowAsSchema } from '../show-as';

export const numberFieldOptionsSchema = z
  .object({
    formatting: numberFormattingSchema,
    showAs: numberShowAsSchema.optional(),
  })
  .strict();

export type INumberFieldOptions = z.infer<typeof numberFieldOptionsSchema>;

export const numberCellValueSchema = z.number();

export type INumberCellValue = z.infer<typeof numberCellValueSchema>;

export class NumberFieldCore extends FieldCore {
  type!: FieldType.Number;

  options!: INumberFieldOptions;

  cellValueType!: CellValueType.Number;

  static defaultOptions(): INumberFieldOptions {
    return {
      formatting: defaultNumberFormatting,
    };
  }

  cellValue2String(cellValue: number | number[] | undefined) {
    if (cellValue == null) {
      return '';
    }
    const formatting = this.options.formatting;

    if (this.isMultipleCellValue && Array.isArray(cellValue)) {
      return cellValue.map((v) => formatNumberToString(v, formatting)).join(', ');
    }

    return formatNumberToString(cellValue as number, formatting);
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
    return null;
  }

  validateOptions() {
    return z
      .object({
        formatting: numberFormattingSchema,
        showAs: getShowAsSchema(this.cellValueType, this.isMultipleCellValue),
      })
      .safeParse(this.options);
  }

  validateCellValue(value: unknown) {
    if (this.isMultipleCellValue) {
      return z.array(numberCellValueSchema).nonempty().nullable().safeParse(value);
    }
    return numberCellValueSchema.nullable().safeParse(value);
  }
}
