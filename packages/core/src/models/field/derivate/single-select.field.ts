import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import { SelectFieldCore } from './abstract/select.field.abstract';

export const singleSelectCelValueSchema = z.string();

export type ISingleSelectCellValue = z.infer<typeof singleSelectCelValueSchema>;

export class SingleSelectFieldCore extends SelectFieldCore {
  type!: FieldType.SingleSelect;

  cellValueType!: CellValueType.String;

  convertStringToCellValue(value: string, shouldExtend?: boolean): string | null {
    if (this.isLookup) {
      return null;
    }

    if (value === '' || value == null) {
      return null;
    }

    const cellValue = String(value).replace(/\n|\r/g, ' ').trim();
    if (shouldExtend) {
      return cellValue;
    }

    if (this.options.choices.find((c) => c.name === cellValue)) {
      return cellValue;
    }

    return null;
  }

  repair(value: unknown) {
    if (this.isLookup) {
      return null;
    }

    if (typeof value === 'string') {
      return this.convertStringToCellValue(value);
    }

    return null;
  }
}
