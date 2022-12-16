import type { FieldType } from './constant';
import { Field } from './field';
import type { IFieldBase } from './interface';

export interface INumberFieldOptions {
  precision: number;
}

export interface INumberField extends IFieldBase {
  type: FieldType.Number;
  options: INumberFieldOptions;
  defaultValue: number;
}

export class NumberField extends Field {
  constructor(public readonly field: INumberField) {
    super(field);
  }

  get type() {
    return this.field.type;
  }

  get defaultValue() {
    return this.field.defaultValue;
  }
}
