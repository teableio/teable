import { RollupFieldCore } from '@teable/core';
import type { IFieldBase } from '../field-base';

export class RollupFieldDto extends RollupFieldCore implements IFieldBase {
  isStructuredCellValue = false;

  convertCellValue2DBValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return value == null ? value : JSON.stringify(value);
    }
    return value;
  }

  convertDBValue2CellValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return value == null || typeof value === 'object' ? value : JSON.parse(value as string);
    }
    return value;
  }
}
