import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';

export const singlelineTextFieldOptionsSchema = z.object({});

export type ISingleLineTextFieldOptions = z.infer<typeof singlelineTextFieldOptionsSchema>;

export const singleLineTextCelValueSchema = z.string();

export type ISingleLineTextCellValue = z.infer<typeof singleLineTextCelValueSchema>;

export class SingleLineTextFieldCore extends FieldCore {
  type!: FieldType.SingleLineText;

  options!: ISingleLineTextFieldOptions;

  cellValueType!: CellValueType.String;

  static defaultOptions() {
    return null;
  }

  cellValue2String(cellValue: string | string[] | undefined) {
    if (this.isMultipleCellValue && Array.isArray(cellValue)) {
      return cellValue.join(', ');
    }
    return (cellValue as string) ?? '';
  }

  convertStringToCellValue(value: string): string | null {
    if (this.isLookup) {
      return null;
    }

    if (value === '' || value == null) {
      return null;
    }

    return value;
  }

  repair(value: unknown) {
    if (this.isLookup) {
      return null;
    }

    if (typeof value === 'string') {
      return this.convertStringToCellValue(value);
    }
    return String(value);
  }

  validateOptions() {
    return singlelineTextFieldOptionsSchema.safeParse(this.options);
  }

  validateCellValue(value: unknown) {
    if (this.isMultipleCellValue) {
      return z.array(singleLineTextCelValueSchema).nonempty().optional().safeParse(value);
    }
    return singleLineTextCelValueSchema.optional().safeParse(value);
  }
}
