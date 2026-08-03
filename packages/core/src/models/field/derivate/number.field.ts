import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import type { IFieldVisitor } from '../field-visitor.interface';
import {
  defaultNumberFormatting,
  formatNumberToString,
  numberFormattingSchema,
  parseStringToNumber,
} from '../formatting';
import { getShowAsSchema } from '../show-as';
import { type INumberFieldOptions } from './number-option.schema';

export const numberCellValueSchema = z.number();

export type INumberCellValue = z.infer<typeof numberCellValueSchema>;

export class NumberFieldCore extends FieldCore {
  type!: FieldType.Number;

  options!: INumberFieldOptions;

  meta?: undefined;

  cellValueType!: CellValueType.Number;

  static defaultOptions(): INumberFieldOptions {
    return {
      formatting: defaultNumberFormatting,
    };
  }

  cellValue2String(cellValue?: unknown) {
    if (cellValue == null) {
      return '';
    }

    if (this.isMultipleCellValue && Array.isArray(cellValue)) {
      return cellValue.map((v) => this.item2String(v)).join(', ');
    }

    return this.item2String(cellValue as number);
  }

  item2String(value?: unknown): string {
    return formatNumberToString(value as number, this.options.formatting);
  }

  convertStringToCellValue(value: string): number | null {
    if (this.isLookup) {
      return null;
    }

    return parseStringToNumber(value, this.options.formatting);
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

  accept<T>(visitor: IFieldVisitor<T>): T {
    return visitor.visitNumberField(this);
  }
}
