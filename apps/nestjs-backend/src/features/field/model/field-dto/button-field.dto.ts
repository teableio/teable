import { ButtonFieldCore } from '@teable/core';
import type { FieldBase } from '../field-base';

export class ButtonFieldDto extends ButtonFieldCore implements FieldBase {
  get isStructuredCellValue(): boolean {
    return false;
  }
  convertCellValue2DBValue(_value: unknown): unknown {
    return null;
  }

  convertDBValue2CellValue(_value: unknown): unknown {
    return null;
  }
}
