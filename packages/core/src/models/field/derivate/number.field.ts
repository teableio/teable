import type { DbFieldType, FieldType } from '../constant';
import type { CellValueType } from '../field';
import { FieldCore } from '../field';

export class NumberFieldOptions {
  precision!: number;
}

export class NumberFieldCore extends FieldCore {
  type!: FieldType.Number;

  dbFieldType!: DbFieldType.Real;

  options: NumberFieldOptions | undefined;

  defaultValue?: number;

  calculatedType!: FieldType.Number;

  cellValueType!: CellValueType.Number;

  isComputed!: false;

  cellValue2String(cellValue: number) {
    if (cellValue == null) {
      return '';
    }
    const precision = this.options?.precision || 0;
    return cellValue.toFixed(precision);
  }

  convertStringToCellValue(value: string): number | null {
    const num = Number(value);
    if (Number.isNaN(num)) {
      return null;
    }
    return num;
  }

  repair(value: unknown) {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      return this.convertStringToCellValue(value);
    }
    throw new Error(`invalid value: ${value} for field: ${this.name}`);
  }
}
