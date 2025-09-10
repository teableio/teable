import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';

export const checkboxFieldOptionsSchema = z
  .object({ defaultValue: z.boolean().optional() })
  .strict();

export type ICheckboxFieldOptions = z.infer<typeof checkboxFieldOptionsSchema>;

export const booleanCellValueSchema = z.boolean();

export type ICheckboxCellValue = z.infer<typeof booleanCellValueSchema>;

export class CheckboxFieldCore extends FieldCore {
  type!: FieldType.Checkbox;

  options!: ICheckboxFieldOptions;

  cellValueType!: CellValueType.Boolean;

  static defaultOptions(): ICheckboxFieldOptions {
    return {};
  }

  cellValue2String(cellValue?: unknown) {
    if (cellValue == null) {
      return '';
    }

    if (this.isMultipleCellValue && Array.isArray(cellValue)) {
      return cellValue.map(String).join(', ');
    }

    return String(cellValue);
  }

  convertStringToCellValue(value: string): boolean | null {
    if (this.isLookup) {
      return null;
    }

    return value ? true : null;
  }

  // eslint-disable-next-line sonarjs/no-identical-functions
  repair(value: unknown) {
    if (this.isLookup) {
      return null;
    }

    if (typeof value === 'string') {
      const lowercase = value.toLowerCase();
      if (lowercase === 'true') {
        return true;
      }
      if (lowercase === 'false') {
        return null;
      }
    }

    return value ? true : null;
  }

  item2String(item?: unknown) {
    return item ? 'true' : '';
  }

  validateOptions() {
    return checkboxFieldOptionsSchema.safeParse(this.options);
  }

  // checkbox value only allow true or null, false should be convert to null
  validateCellValue(value: unknown) {
    if (this.isMultipleCellValue) {
      return z.array(z.literal(true)).nonempty().nullable().safeParse(value);
    }
    return z
      .boolean()
      .nullable()
      .transform((val) => (val === false ? null : val))
      .safeParse(value);
  }
}
