import type { FieldType, DbFieldType } from '../constant';
import type { CellValueType } from '../field';
import { FieldCore } from '../field';

export class SingleLineTextFieldCore extends FieldCore {
  type!: FieldType.SingleLineText;

  dbFieldType!: DbFieldType.Text;

  options?: undefined;

  defaultValue?: string;

  calculatedType!: FieldType.SingleLineText;

  cellValueType!: CellValueType.String;

  isComputed!: false;

  cellValue2String(cellValue: string) {
    return cellValue;
  }

  convertStringToCellValue(value: string): string | null {
    if (value === '' || value == null) {
      return null;
    }

    return value;
  }
}
