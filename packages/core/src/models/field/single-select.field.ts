import type { Colors } from './colors';
import type { FieldType } from './constant';
import type { CellValueType } from './field';
import { Field } from './field';

export class SingleSelectFieldChoices {
  name!: string;
  color!: Colors;
}

export class SingleSelectFieldOptions {
  choices!: SingleSelectFieldChoices[];
}

export class SingleSelectField extends Field {
  type!: FieldType.SingleSelect;

  options!: SingleSelectFieldOptions;

  defaultValue!: string;

  calculatedType!: FieldType.SingleSelect;

  cellValueType!: CellValueType.String;
}
