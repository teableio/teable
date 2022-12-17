import type { FieldType } from './constant';
import { CellValueType, Field } from './field';
import type { IFieldBase } from './interface';

export interface ISingleLineTextField extends IFieldBase {
  type: FieldType.SingleLineText;
  defaultValue: string;
}

export class SingleLineTextField extends Field {
  constructor(public readonly data: ISingleLineTextField) {
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
    return CellValueType.String;
  }
}

// const t = new SingleLineTextField();

// t.type
