import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import { singleLineTextShowAsSchema } from '../show-as';

export const singlelineTextFieldOptionsSchema = z.object({
  showAs: singleLineTextShowAsSchema.optional(),
  defaultValue: z
    .string()
    .optional()
    .transform((value) => (typeof value === 'string' ? value.trim() : value)),
});

export type ISingleLineTextFieldOptions = z.infer<typeof singlelineTextFieldOptionsSchema>;

export const singleLineTextCelValueSchema = z.string();

export type ISingleLineTextCellValue = z.infer<typeof singleLineTextCelValueSchema>;

export class SingleLineTextFieldCore extends FieldCore {
  type!: FieldType.SingleLineText;

  options!: ISingleLineTextFieldOptions;

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

    if (value === '' || value == null) {
      return null;
    }

    // eslint-disable-next-line regexp/prefer-character-class
    return value.replace(/\n|\r|\t/g, ' ').trim();
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
    return singleLineTextCelValueSchema.nullable().safeParse(value);
  }
}
