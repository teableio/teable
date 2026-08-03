import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import type { IFieldVisitor } from '../field-visitor.interface';
import {
  singlelineTextFieldOptionsSchema,
  type ISingleLineTextFieldOptions,
} from './single-line-text-option.schema';

export const singleLineTextCelValueSchema = z.string();

export type ISingleLineTextCellValue = z.infer<typeof singleLineTextCelValueSchema>;

export class SingleLineTextFieldCore extends FieldCore {
  type!: FieldType.SingleLineText;

  options!: ISingleLineTextFieldOptions;

  meta?: undefined;

  cellValueType!: CellValueType.String;

  static defaultOptions(): ISingleLineTextFieldOptions {
    return {};
  }

  cellValue2String(cellValue?: unknown) {
    if (this.isMultipleCellValue && Array.isArray(cellValue)) {
      return cellValue.join(', ');
    }
    return (cellValue as string) ?? '';
  }

  item2String(value?: unknown): string {
    return value ? String(value) : '';
  }

  convertStringToCellValue(value: string): string | null {
    if (this.isLookup) {
      return null;
    }

    // value may be the null
    // eslint-disable-next-line regexp/prefer-character-class
    const realValue = value?.replace(/[\n\r\t]/g, ' ')?.trim() ?? null;

    if (realValue === '' || realValue == null) {
      return null;
    }

    return realValue;
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
      return z.array(singleLineTextCelValueSchema).nonempty().nullable().safeParse(value);
    }
    return z
      .string()
      .transform((val) => (val === '' ? null : val))
      .nullable()
      .safeParse(value);
  }

  accept<T>(visitor: IFieldVisitor<T>): T {
    return visitor.visitSingleLineTextField(this);
  }
}
