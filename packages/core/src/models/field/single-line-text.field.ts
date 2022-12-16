import type { FieldType } from './constant';
import { Field } from './field';
import type { IFieldBase } from './interface';

export interface ISingleLineTextField extends IFieldBase {
  type: FieldType.SingleLineText;
  defaultValue: string;
}

export class SingleLineTextField extends Field {
  constructor(public readonly field: ISingleLineTextField) {
    super(field);
  }

  get type() {
    return this.field.type;
  }

  get defaultValue() {
    return this.field.defaultValue;
  }
}

// const t = new SingleLineTextField();

// t.type
