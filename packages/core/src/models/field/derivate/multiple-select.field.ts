import type { Colors } from '../colors';
import type { FieldType, DbFieldType } from '../constant';
import type { CellValueType } from '../field';
import { FieldCore } from '../field';

export class MultipleSelectFieldChoices {
  name!: string;
  color!: Colors;
}

export class MultipleSelectFieldOptions {
  choices!: MultipleSelectFieldChoices[];
}

export class MultipleSelectFieldCore extends FieldCore {
  type!: FieldType.MultipleSelect;

  dbFieldType!: DbFieldType.Json;

  options!: MultipleSelectFieldOptions;

  defaultValue!: string[];

  calculatedType!: FieldType.MultipleSelect;

  cellValueType!: CellValueType.Array;

  declare cellValueElementType: CellValueType.String;

  isComputed!: false;

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
}
