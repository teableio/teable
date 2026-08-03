import { ConditionalRollupFieldCore } from '@teable/core';
import type { FieldBase } from '../field-base';

export class ConditionalRollupFieldDto extends ConditionalRollupFieldCore implements FieldBase {
  get isStructuredCellValue() {
    return false;
  }

  convertCellValue2DBValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return value == null ? value : JSON.stringify(value);
    }
    if (typeof value === 'number' && (isNaN(value) || !isFinite(value))) {
      return null;
    }
    return value;
  }

  convertDBValue2CellValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return value == null || typeof value === 'object' ? value : JSON.parse(value as string);
    }
    if (typeof value === 'bigint') {
      return Number(value);
    }
    return value;
  }
}
