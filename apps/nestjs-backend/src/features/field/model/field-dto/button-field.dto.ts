import { ButtonFieldCore } from '@teable/core';
import type { FieldBase } from '../field-base';

export class ButtonFieldDto extends ButtonFieldCore implements FieldBase {
  get isStructuredCellValue(): boolean {
    return false;
  }
  convertCellValue2DBValue(value: unknown): unknown {
    return value && JSON.stringify(value);
  }

  convertDBValue2CellValue(value: unknown): unknown {
    return value == null || typeof value === 'object' ? value : JSON.parse(value as string);
  }
}
