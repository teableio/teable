import type { Colors } from './colors';
import type { FieldType } from './constant';
import { Field } from './field';
import type { IFieldBase } from './interface';

export interface ISingleSelectFieldChoices {
  name: string;
  color: Colors;
}

export interface ISingleSelectFieldOptions {
  choices: ISingleSelectFieldChoices[];
}

export interface ISingleSelectField extends IFieldBase {
  type: FieldType.SingleSelect;
  options: ISingleSelectFieldOptions;
  defaultValue: string;
}

export class SingleSelectField extends Field {
  constructor(public readonly field: ISingleSelectField) {
    super(field);
  }

  get type() {
    return this.field.type;
  }

  get defaultValue() {
    return this.field.defaultValue;
  }
}
