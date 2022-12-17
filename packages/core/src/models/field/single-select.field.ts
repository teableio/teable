import type { Colors } from './colors';
import type { FieldType } from './constant';
import { CellValueType, Field } from './field';
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
  constructor(public readonly data: ISingleSelectField) {
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
