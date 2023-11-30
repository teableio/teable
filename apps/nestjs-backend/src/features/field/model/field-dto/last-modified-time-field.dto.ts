import { LastModifiedTimeFieldCore } from '@teable-group/core';
import type { IFieldBase } from '../field-base';

export class LastModifiedTimeFieldDto extends LastModifiedTimeFieldCore implements IFieldBase {
  convertCellValue2DBValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return JSON.stringify(value);
    }
    return value;
  }

  convertDBValue2CellValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return value == null || typeof value === 'object' ? value : JSON.parse(value as string);
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    return value;
  }
}
