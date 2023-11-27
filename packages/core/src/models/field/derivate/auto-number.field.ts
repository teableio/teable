import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import { FormulaAbstractCore } from './abstract/formula.field.abstract';

export const autoNumberFieldOptionsSchema = z
  .object({
    expression: z.literal('AUTO_NUMBER()'),
  })
  .strict();

export type IAutoNumberFieldOptions = z.infer<typeof autoNumberFieldOptionsSchema>;

export const autoNumberFieldOptionsRoSchema = autoNumberFieldOptionsSchema.partial({
  expression: true,
});

export const autoNumberCellValueSchema = z.number().int();

export class AutoNumberFieldCore extends FormulaAbstractCore {
  type!: FieldType.AutoNumber;

  declare options: IAutoNumberFieldOptions;

  declare cellValueType: CellValueType.Number;

  static defaultOptions(): IAutoNumberFieldOptions {
    return {
      expression: 'AUTO_NUMBER()',
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
    if (value == null) {
      return '';
    }
    return String(value);
  }

  convertStringToCellValue(_value: string): null {
    return null;
  }

  repair(_value: unknown): null {
    return null;
  }

  validateOptions() {
    return autoNumberFieldOptionsSchema.safeParse(this.options);
  }

  validateCellValue(value: unknown) {
    if (this.isMultipleCellValue) {
      return z.array(autoNumberCellValueSchema).nonempty().nullable().safeParse(value);
    }
    return autoNumberCellValueSchema.nullable().safeParse(value);
  }
}
