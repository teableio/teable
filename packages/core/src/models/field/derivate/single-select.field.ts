import type { Colors } from '../colors';
import type { FieldType, DbFieldType } from '../constant';
import type { CellValueType } from '../field';
import { FieldCore } from '../field';

export class SingleSelectFieldChoices {
  name!: string;
  color!: Colors;
}

export class SingleSelectFieldOptions {
  choices!: SingleSelectFieldChoices[];
}

export class SingleSelectFieldCore extends FieldCore {
  type!: FieldType.SingleSelect;

  dbFieldType!: DbFieldType.Text;

  options!: SingleSelectFieldOptions;

  defaultValue!: string;

  calculatedType!: FieldType.SingleSelect;

  cellValueType!: CellValueType.String;

  isComputed!: false;

  cellValue2String(cellValue: string) {
    return cellValue;
  }

  convertStringToCellValue(value: string): string | null {
    if (value === '' || value == null) {
      return null;
    }

    if (this.options.choices.find((c) => c.name === value)) {
      return value;
    }

    return null;
  }
}
