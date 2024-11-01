import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import { SelectFieldCore } from './abstract/select.field.abstract';

export const multipleSelectCelValueSchema = z.array(z.string());

export type IMultipleSelectCellValue = z.infer<typeof multipleSelectCelValueSchema>;

export class MultipleSelectFieldCore extends SelectFieldCore {
  type!: FieldType.MultipleSelect;

  cellValueType!: CellValueType.String;

  isMultipleCellValue = true;

  convertStringToCellValue(value: string, shouldExtend?: boolean): string[] | null {
    if (value == null) {
      return null;
    }

    let cellValue = value.split(/[\n\r,]\s?(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((item) => {
      return item.includes(',') ? item.slice(1, -1).trim() : item.trim();
    });

    cellValue = shouldExtend
      ? cellValue
      : cellValue.filter((value) => this.options.choices.find((c) => c.name === value));

    return cellValue.length === 0 ? null : cellValue;
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
}
