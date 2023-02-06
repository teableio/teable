import type { FieldType } from './constant';
import type { CellValueType } from './field';
import { Field } from './field';

export class NumberFieldOptions {
  precision!: number;
}

export class NumberField extends Field {
  type!: FieldType.Number;

  options!: NumberFieldOptions;

  defaultValue?: number;

  calculatedType!: FieldType.Number;

  cellValueType!: CellValueType.Number;
}
