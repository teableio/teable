import type { DbFieldType, FieldType } from './constant';
import type { CellValueType } from './field';
import { FieldCore } from './field';

export class NumberFieldOptions {
  precision!: number;
}

export class NumberFieldCore extends FieldCore {
  type!: FieldType.Number;

  dbFieldType!: DbFieldType.Real;

  options!: NumberFieldOptions;

  defaultValue?: number;

  calculatedType!: FieldType.Number;

  cellValueType!: CellValueType.Number;

  isComputed!: false;

  cellValue2String(cellValue: number) {
    return cellValue.toFixed(this.options.precision);
  }

  convertStringToCellValue(value: string): number | null {
    const num = Number(value);
    if (Number.isNaN(num)) {
      return null;
    }
    return num;
  }
}
