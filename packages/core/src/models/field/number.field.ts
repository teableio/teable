import type { FieldType } from './constant';
import { CellValueType, Field } from './field';
import type { IFieldBase } from './interface';

export interface INumberFieldOptions {
  precision: number;
}

export interface INumberField extends IFieldBase {
  type: FieldType.Number;
  options: INumberFieldOptions;
  defaultValue: string;
}

export class NumberField extends Field {
  constructor(public readonly data: INumberField) {
    super(data);
  }

  get type() {
    return this.data.type;
  }

  get defaultValue() {
    return this.data.defaultValue;
  }

  get calculatedType() {
    return this.data.type;
  }

  get cellValueType() {
    return CellValueType.Number;
  }
}
