import { CheckboxFieldCore } from '@teable/core';
import type { IFieldBase } from '../field-base';

export class CheckboxFieldDto extends CheckboxFieldCore implements IFieldBase {
  isStructuredCellValue = false;

  convertCellValue2DBValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return value == null ? value : JSON.stringify(value);
    }
    return value ? true : null;
  }

  convertDBValue2CellValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return value == null || typeof value === 'object' ? value : JSON.parse(value as string);
    }
    return value ? true : null;
  }
}
