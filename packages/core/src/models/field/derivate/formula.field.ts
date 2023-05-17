import { z } from 'zod';
import type { FieldType, DbFieldType } from '../constant';
import type { CellValueType } from '../field';
import { FieldCore } from '../field';
import type { NumberFieldOptions } from './number.field';

export class FormulaFieldOptions {
  expression!: string;

  formatting?: NumberFieldOptions;
}

export class FormulaFieldCore extends FieldCore {
  type!: FieldType.Formula;

  dbFieldType!: DbFieldType;

  options!: FormulaFieldOptions;

  defaultValue!: null;

  calculatedType!: FieldType.Formula;

  cellValueType!: CellValueType;

  declare cellValueElementType?: CellValueType;

  isComputed!: true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cellValue2String(cellValue: any) {
    if (Array.isArray(cellValue)) {
      return cellValue.join(', ');
    }
    return cellValue ? String(cellValue) : '';
  }

  convertStringToCellValue(_value: string): string[] | null {
    return null;
  }

  repair(value: unknown) {
    return value;
  }

  validateOptions() {
    return z
      .object({
        expression: z.string(),
        formatting: z
          .object({
            precision: z.number().max(5).min(0),
          })
          .optional(),
      })
      .safeParse(this.options);
  }

  validateDefaultValue() {
    return z.null().safeParse(this.defaultValue);
  }
}
