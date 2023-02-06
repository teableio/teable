import type { FieldType } from './constant';
import type { CellValueType } from './field';
import { Field } from './field';

export class SingleLineTextField extends Field {
  type!: FieldType.SingleLineText;

  options?: undefined;

  defaultValue?: string;

  calculatedType!: FieldType.SingleLineText;

  cellValueType!: CellValueType.String;
}
