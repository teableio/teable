import { z } from 'zod';
import type { CellValueType, FieldType } from '../constant';
import { FieldCore } from '../field';

export const longTextFieldOptionsSchema = z
  .object({
    defaultValue: z
      .string()
      .optional()
      .transform((value) => (typeof value === 'string' ? value.trim() : value)),
  })
  .strict();

export type ILongTextFieldOptions = z.infer<typeof longTextFieldOptionsSchema>;

export const longTextCelValueSchema = z.string();

export type ILongTextCellValue = z.infer<typeof longTextCelValueSchema>;

export class LongTextFieldCore extends FieldCore {
  type!: FieldType.LongText;

  options!: ILongTextFieldOptions;

  cellValueType!: CellValueType.String;

  static defaultOptions(): ILongTextFieldOptions {
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

    if (value === '' || value == null) {
      return null;
    }

    return value.trim();
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
    return longTextFieldOptionsSchema.safeParse(this.options);
  }

  validateCellValue(value: unknown) {
    if (this.isMultipleCellValue) {
      return z.array(longTextCelValueSchema).nonempty().nullable().safeParse(value);
    }
    return longTextCelValueSchema.nullable().safeParse(value);
  }
}
