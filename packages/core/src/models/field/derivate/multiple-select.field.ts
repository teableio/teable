import { z } from 'zod';
import type { FieldType, DbFieldType } from '../constant';
import type { CellValueType } from '../field';
import { SelectFieldCore } from './select.field.abstract';

export class MultipleSelectFieldCore extends SelectFieldCore {
  type!: FieldType.MultipleSelect;

  dbFieldType!: DbFieldType.Json;

  defaultValue!: string[] | null;

  calculatedType!: FieldType.MultipleSelect;

  cellValueType!: CellValueType.Array;

  declare cellValueElementType: CellValueType.String;

  cellValue2String(cellValue: string[]) {
    return cellValue.join(', ');
  }

  convertStringToCellValue(value: string): string[] | null {
    if (value === '' || value == null) {
      return null;
    }

    let cellValue = value.split(', ');
    cellValue = cellValue.filter((value) => this.options.choices.find((c) => c.name === value));

    if (cellValue.length === 0) {
      return null;
    }

    return cellValue;
  }

  repair(value: unknown) {
    if (Array.isArray(value)) {
      const cellValue = value.filter((value) => this.options.choices.find((c) => c.name === value));

      if (cellValue.length === 0) {
        return null;
      }
      return cellValue;
    }

    if (typeof value === 'string') {
      return this.convertStringToCellValue(value);
    }

    throw new Error(`invalid value: ${value} for field: ${this.name}`);
  }

  validateDefaultValue() {
    const choiceNames = this.options.choices.map((v) => v.name);
    return z
      .string()
      .nullable()
      .optional()
      .refine(
        (value) => {
          return value == null || choiceNames.includes(value);
        },
        { message: `${this.defaultValue} is not one of the choice names` }
      )
      .safeParse(this.defaultValue);
  }
}
