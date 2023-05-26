import { z } from 'zod';
import type { FieldType, DbFieldType, CellValueType } from '../constant';
import { SelectFieldCore } from './select.field.abstract';

export class SingleSelectFieldCore extends SelectFieldCore {
  type!: FieldType.SingleSelect;

  dbFieldType!: DbFieldType.Text;

  defaultValue: string | null = null;

  calculatedType!: FieldType.SingleSelect;

  cellValueType!: CellValueType.String;

  cellValue2String(cellValue: string) {
    return cellValue;
  }

  convertStringToCellValue(value: string): string | null {
    if (value === '' || value == null) {
      return null;
    }

    if (this.options.choices.find((c) => c.name === value)) {
      return value;
    }

    return null;
  }

  repair(value: unknown) {
    if (typeof value === 'string') {
      return this.convertStringToCellValue(value);
    }

    throw new Error(`invalid value: ${value} for field: ${this.name}`);
  }

  validateDefaultValue() {
    const choiceNames = this.options.choices.map((v) => v.name);
    return z
      .string()
      .refine(
        (value) => {
          return value == null || choiceNames.includes(value);
        },
        { message: `${this.defaultValue} is not one of the choice names` }
      )
      .nullable()
      .optional()
      .safeParse(this.defaultValue);
  }
}
