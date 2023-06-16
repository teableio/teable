import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';

export class SingleLineTextFieldCore extends FieldCore {
  type!: FieldType.SingleLineText;

  options = null;

  defaultValue: string | null = null;

  cellValueType!: CellValueType.String;

  static defaultOptions() {
    return null;
  }

  cellValue2String(cellValue: string) {
    return cellValue ?? '';
  }

  convertStringToCellValue(value: string): string | null {
    if (value === '' || value == null) {
      return null;
    }

    return value;
  }

  repair(value: unknown) {
    if (typeof value === 'string') {
      return this.convertStringToCellValue(value);
    }
    return String(value);
  }

  validateOptions() {
    return z.undefined().nullable().safeParse(this.options);
  }

  validateDefaultValue() {
    return z.string().optional().nullable().safeParse(this.defaultValue);
  }
}
